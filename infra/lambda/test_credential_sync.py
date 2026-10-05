"""Unit tests for the P1.1 credential synchronization function.

Run with:  python infra/lambda/test_credential_sync.py

Covers the behaviours the P1.1 authorization calls out explicitly: the no-op
path, the synchronization path, the settle window, the stability requirement,
malformed application secret rejection, PutSecretValue failure handling,
state-version behaviour, and a regression guard for the stale AWSPENDING label
that RDS left on this secret.
"""

import datetime
import importlib
import json
import os
import sys
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))

os.environ.setdefault("METRIC_NAMESPACE", "Swapify/CredentialSync/Test")
os.environ.setdefault("RDS_MASTER_SECRET_ARN", "arn:aws:secretsmanager:eu-west-1:1:secret:rds!db-test")
os.environ.setdefault("APP_DATABASE_URL_SECRET_ARN", "arn:aws:secretsmanager:eu-west-1:1:secret:app-test")
os.environ.setdefault("STATE_PARAMETER_NAME", "/swapify/test/rds-source-version")
os.environ.setdefault("ECS_CLUSTER_NAME", "swapify-test")
os.environ.setdefault("ECS_SERVICE_NAME", "swapify-api-test")
os.environ.setdefault("SETTLE_SECONDS", "600")
os.environ.setdefault("REQUIRED_STABLE_POLLS", "2")

sys.path.insert(0, HERE)
cs = importlib.import_module("credential_sync")

NOW = 1_800_000_000.0
APP_URL = "postgresql://swapify_app:oldpw@db.example.internal:5432/swapify"
RDS_PASSWORD = "newpw-With~Specials/Chars+And@At"


def dt(epoch):
    return datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc)


class FakeSecrets:
    def __init__(self, version, stages, last_changed, app_url, authoritative_password):
        self.version = version
        self.stages = stages
        self.last_changed = last_changed
        self.app_url = app_url
        self.authoritative_password = authoritative_password
        self.writes = []
        self.get_calls = []
        self.put_error = None

    def describe_secret(self, SecretId):
        assert SecretId == cs.RDS_MASTER_SECRET_ARN
        return {
            "VersionIdsToStages": {self.version: list(self.stages)},
            "LastChangedDate": dt(self.last_changed),
        }

    def get_secret_value(self, SecretId):
        self.get_calls.append(SecretId)
        if SecretId == cs.RDS_MASTER_SECRET_ARN:
            return {
                "SecretString": json.dumps(
                    {"username": "swapify_app", "password": self.authoritative_password}
                )
            }
        return {"SecretString": self.app_url}

    def put_secret_value(self, SecretId, SecretString):
        if self.put_error:
            raise self.put_error
        assert SecretId == cs.APP_SECRET_ARN
        self.writes.append(SecretString)
        self.app_url = SecretString
        return {"VersionId": "written"}


class FakeSsm:
    def __init__(self, state):
        self.state = dict(state or {})
        self.puts = []

    def get_parameter(self, Name):
        assert Name == cs.STATE_PARAMETER_NAME
        if not self.state:
            raise mock.Mock(
                response={"Error": {"Code": "ParameterNotFound"}},
                **{"response": {"Error": {"Code": "ParameterNotFound"}}},
            )
        return {"Parameter": {"Value": json.dumps(self.state)}}

    def put_parameter(self, Name, Value, Type, Overwrite):
        assert Name == cs.STATE_PARAMETER_NAME
        assert Overwrite is True
        self.state = json.loads(Value)
        self.puts.append(self.state)
        return {}


class FakeEcs:
    def __init__(self, error=None):
        self.calls = []
        self.error = error

    def update_service(self, cluster, service, forceNewDeployment):
        self.calls.append((cluster, service, forceNewDeployment))
        if self.error:
            raise self.error


class FakeCw:
    def __init__(self):
        self.metrics = []

    def put_metric_data(self, Namespace, MetricData):
        for m in MetricData:
            self.metrics.append((Namespace, m["MetricName"], m["Value"]))

    def value(self, name):
        return [v for _, n, v in self.metrics if n == name]


def install(sm, ssm, ecs, cw):
    return mock.patch.multiple(
        cs, _sm=sm, _ssm=ssm, _ecs=ecs, _cw=cw, create=False
    )


def run_once(sm, ssm, ecs, cw, now=NOW):
    with install(sm, ssm, ecs, cw):
        return cs._poll(force_now=now)


class RebuildUrlTests(unittest.TestCase):
    def test_replaces_only_the_password(self):
        out = cs.rebuild_url(APP_URL, RDS_PASSWORD)
        parts = out.split("://", 1)[1]
        creds, _, hostpart = parts.partition("@")
        self.assertTrue(out.startswith("postgresql://"))
        self.assertEqual(creds, "swapify_app:" + cs.quote(RDS_PASSWORD, safe=""))
        self.assertEqual(hostpart, "db.example.internal:5432/swapify")

    def test_preserves_query_and_fragment(self):
        src = APP_URL + "?sslmode=require&x=1#frag"
        out = cs.rebuild_url(src, RDS_PASSWORD)
        self.assertTrue(out.endswith("?sslmode=require&x=1#frag"))

    def test_round_trips_password_through_extraction(self):
        out = cs.rebuild_url(APP_URL, RDS_PASSWORD)
        self.assertEqual(cs._extract_password(out), RDS_PASSWORD)

    def test_rejects_non_postgres_scheme(self):
        with self.assertRaises(cs.SyncAborted):
            cs.rebuild_url("mysql://u:p@h:3306/d", "x")

    def test_rejects_missing_host(self):
        with self.assertRaises(cs.SyncAborted):
            cs.rebuild_url("postgresql://u:p@/d", "x")

    def test_rejects_missing_port(self):
        with self.assertRaises(cs.SyncAborted):
            cs.rebuild_url("postgresql://u:p@host/db", "x")

    def test_rejects_missing_database(self):
        with self.assertRaises(cs.SyncAborted):
            cs.rebuild_url("postgresql://u:p@host:5432/", "x")

    def test_rejects_missing_username(self):
        with self.assertRaises(cs.SyncAborted):
            cs.rebuild_url("postgresql://:p@host:5432/db", "x")


class NoOpTests(unittest.TestCase):
    def test_noop_when_versions_match(self):
        sm = FakeSecrets("v1", ["AWSCURRENT"], NOW - 10_000, APP_URL, RDS_PASSWORD)
        ssm = FakeSsm({"syncedVersionId": "v1"})
        ecs, cw = FakeEcs(), FakeCw()

        report = run_once(sm, ssm, ecs, cw)

        self.assertEqual(report["action"], "noop")
        self.assertEqual(sm.writes, [])
        self.assertEqual(ecs.calls, [])
        self.assertEqual(cw.value("Heartbeat"), [1.0])
        self.assertEqual(cw.value("DriftDetected"), [0.0])
        self.assertEqual(cw.value("SyncSucceeded"), [])

    def test_noop_does_not_read_any_secret_value(self):
        sm = FakeSecrets("v1", ["AWSCURRENT"], NOW - 10_000, APP_URL, RDS_PASSWORD)
        ssm = FakeSsm({"syncedVersionId": "v1"})
        run_once(sm, ssm, FakeEcs(), FakeCw())
        self.assertEqual(sm.get_calls, [])


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.sm = FakeSecrets("v2", ["AWSCURRENT"], NOW - 10_000, APP_URL, RDS_PASSWORD)
        self.ssm = FakeSsm({"syncedVersionId": "v1"})
        self.ecs, self.cw = FakeEcs(), FakeCw()

    def test_settles_before_writing(self):
        # Authoritative secret changed 100s ago: inside the 600s settle window.
        sm = FakeSecrets("v2", ["AWSCURRENT"], NOW - 100, APP_URL, RDS_PASSWORD)
        ssm = FakeSsm({"syncedVersionId": "v1"})
        ecs, cw = FakeEcs(), FakeCw()

        report = run_once(sm, ssm, ecs, cw, now=NOW)
        self.assertEqual(report["action"], "settling")
        self.assertEqual(sm.writes, [])
        self.assertEqual(ecs.calls, [])
        self.assertEqual(cw.value("Settling"), [1.0])

    def test_requires_two_stable_polls(self):
        first = run_once(self.sm, self.ssm, self.ecs, self.cw)
        self.assertEqual(first["action"], "awaiting_stability")
        self.assertEqual(self.sm.writes, [])
        self.assertEqual(self.ssm.state["syncedVersionId"], "v1")

        second = run_once(self.sm, self.ssm, self.ecs, self.cw)
        self.assertEqual(second["action"], "synchronised")
        self.assertEqual(len(self.sm.writes), 1)
        self.assertEqual(self.ssm.state["syncedVersionId"], "v2")

    def test_second_poll_redeploys_api_exactly_once(self):
        run_once(self.sm, self.ssm, self.ecs, self.cw)
        run_once(self.sm, self.ssm, self.ecs, self.cw)
        self.assertEqual(
            self.ecs.calls, [("swapify-test", "swapify-api-test", True)]
        )

    def test_subsequent_polls_are_noops(self):
        run_once(self.sm, self.ssm, self.ecs, self.cw)
        run_once(self.sm, self.ssm, self.ecs, self.cw)
        for _ in range(5):
            report = run_once(self.sm, self.ssm, self.ecs, self.cw)
            self.assertEqual(report["action"], "noop")
        self.assertEqual(len(self.sm.writes), 1)
        self.assertEqual(len(self.ecs.calls), 1)

    def test_writes_only_the_password(self):
        run_once(self.sm, self.ssm, self.ecs, self.cw)
        run_once(self.sm, self.ssm, self.ecs, self.cw)
        written = self.sm.writes[0]
        self.assertTrue(written.startswith("postgresql://swapify_app:"))
        self.assertTrue(written.endswith("@db.example.internal:5432/swapify"))
        self.assertEqual(cs._extract_password(written), RDS_PASSWORD)

    def test_emits_success_metrics(self):
        run_once(self.sm, self.ssm, self.ecs, self.cw)
        run_once(self.sm, self.ssm, self.ecs, self.cw)
        self.assertEqual(self.cw.value("SyncSucceeded"), [1.0])
        self.assertEqual(self.cw.value("ApiRedeployRequested"), [1.0])
        self.assertEqual(self.cw.value("DriftDetected")[-1], 0.0)


class StalePendingStageTests(unittest.TestCase):
    """RDS never cleared a stale AWSPENDING label on this secret.

    Rotation-in-progress must therefore be inferred from LastChangedDate and
    version stability, never from the presence of AWSPENDING.
    """

    def test_stale_awspending_does_not_block_synchronization(self):
        sm = FakeSecrets(
            "v2", ["AWSCURRENT", "AWSPENDING"], NOW - 10_000, APP_URL, RDS_PASSWORD
        )
        ssm = FakeSsm({"syncedVersionId": "v1"})
        ecs, cw = FakeEcs(), FakeCw()

        run_once(sm, ssm, ecs, cw)
        report = run_once(sm, ssm, ecs, cw)

        self.assertEqual(report["action"], "synchronised")
        self.assertEqual(len(sm.writes), 1)
        self.assertEqual(len(ecs.calls), 1)

    def test_awspending_only_is_not_treated_as_current(self):
        sm = FakeSecrets("v2", ["AWSPENDING"], NOW - 10_000, APP_URL, RDS_PASSWORD)
        with self.assertRaises(cs.SyncAborted):
            run_once(sm, FakeSsm({}), FakeEcs(), FakeCw())


class FailureTests(unittest.TestCase):
    def test_put_failure_does_not_advance_state(self):
        sm = FakeSecrets("v2", ["AWSCURRENT"], NOW - 10_000, APP_URL, RDS_PASSWORD)
        sm.put_error = cs.ClientError(
            {"Error": {"Code": "InternalServiceError"}}, "PutSecretValue"
        )
        ssm = FakeSsm({"syncedVersionId": "v1"})
        ecs, cw = FakeEcs(), FakeCw()

        run_once(sm, ssm, ecs, cw)  # first poll: records observation
        with self.assertRaises(cs.ClientError):
            run_once(sm, ssm, ecs, cw)

        self.assertEqual(ssm.state["syncedVersionId"], "v1")
        self.assertEqual(ecs.calls, [])

    def test_verification_failure_does_not_advance_state(self):
        class TamperingSecrets(FakeSecrets):
            def put_secret_value(self, SecretId, SecretString):
                # Simulate a write that did not land as intended.
                self.writes.append(SecretString)
                return {"VersionId": "written"}

        sm = TamperingSecrets("v2", ["AWSCURRENT"], NOW - 10_000, APP_URL, RDS_PASSWORD)
        ssm = FakeSsm({"syncedVersionId": "v1"})
        ecs, cw = FakeEcs(), FakeCw()

        run_once(sm, ssm, ecs, cw)
        with self.assertRaises(cs.SyncAborted):
            run_once(sm, ssm, ecs, cw)

        self.assertEqual(ssm.state["syncedVersionId"], "v1")
        self.assertEqual(ecs.calls, [])

    def test_malformed_application_secret_is_never_overwritten(self):
        sm = FakeSecrets(
            "v2", ["AWSCURRENT"], NOW - 10_000, "not-a-url-at-all", RDS_PASSWORD
        )
        ssm = FakeSsm({"syncedVersionId": "v1"})
        ecs, cw = FakeEcs(), FakeCw()

        run_once(sm, ssm, ecs, cw)
        with self.assertRaises(cs.SyncAborted):
            run_once(sm, ssm, ecs, cw)

        self.assertEqual(sm.writes, [])
        self.assertEqual(ssm.state["syncedVersionId"], "v1")
        self.assertEqual(ecs.calls, [])

    def test_redeploy_failure_is_surfaced_but_state_stays_advanced(self):
        sm = FakeSecrets("v2", ["AWSCURRENT"], NOW - 10_000, APP_URL, RDS_PASSWORD)
        ssm = FakeSsm({"syncedVersionId": "v1"})
        ecs = FakeEcs(error=cs.ClientError({"Error": {"Code": "Throttling"}}, "UpdateService"))
        cw = FakeCw()

        run_once(sm, ssm, ecs, cw)
        with self.assertRaises(cs.ClientError):
            run_once(sm, ssm, ecs, cw)

        self.assertEqual(ssm.state["syncedVersionId"], "v2")
        self.assertIn(1.0, cw.value("SyncFailed"))

    def test_handler_emits_failure_and_reraises(self):
        sm = FakeSecrets("v2", ["AWSPENDING"], NOW - 10_000, APP_URL, RDS_PASSWORD)
        ssm, cw = FakeSsm({}), FakeCw()
        with install(sm, ssm, FakeEcs(), cw):
            with self.assertRaises(cs.SyncAborted):
                cs.lambda_handler({}, None)
        self.assertEqual(cw.value("SyncFailed"), [1.0])


class LogSafetyTests(unittest.TestCase):
    def test_failure_detail_never_contains_a_url(self):
        exc = cs.SyncAborted("application secret has no host")
        self.assertNotIn("postgresql://", cs._safe_detail(exc))
        exc2 = cs.ClientError(
            {"Error": {"Code": "AccessDeniedException", "Message": "postgresql://u:p@h/d"}},
            "GetSecretValue",
        )
        self.assertEqual(cs._safe_detail(exc2), "AccessDeniedException")
        self.assertNotIn("postgresql://", cs._safe_detail(exc2))
        self.assertEqual(cs._safe_detail(KeyError("postgresql://u:p@h/d")), "missing expected field")

    def test_metrics_namespace_is_the_approved_one(self):
        sm = FakeSecrets("v1", ["AWSCURRENT"], NOW - 10_000, APP_URL, RDS_PASSWORD)
        cw = FakeCw()
        run_once(sm, FakeSsm({"syncedVersionId": "v1"}), FakeEcs(), cw)
        self.assertTrue(all(ns == "Swapify/CredentialSync/Test" for ns, _, _ in cw.metrics))


class TemplateDriftGuardTests(unittest.TestCase):
    """The deployed function must be the file in this directory, not a copy."""

    def test_template_zipfile_matches_source(self):
        import yaml

        class CfnLoader(yaml.SafeLoader):
            pass

        CfnLoader.add_multi_constructor(
            "!", lambda loader, suffix, node: loader.construct_scalar(node)
        )

        tpl_path = os.path.join(HERE, "..", "cloudformation", "ecs.yml")
        if not os.path.exists(tpl_path):
            self.skipTest("template not present")
        with open(tpl_path, "r", encoding="utf-8") as fh:
            doc = yaml.load(fh, Loader=CfnLoader)

        resource = doc["Resources"].get("CredentialSyncFunction")
        if resource is None:
            self.skipTest("CredentialSyncFunction not yet present in the template")
        inline = resource["Properties"]["Code"]["ZipFile"]
        with open(os.path.join(HERE, "credential_sync.py"), "r", encoding="utf-8") as fh:
            source = fh.read()
        self.assertEqual(inline.strip(), source.strip(), "template Lambda code is stale")


if __name__ == "__main__":
    unittest.main(verbosity=2)