"""P1.1 - keep the application DATABASE_URL aligned with RDS managed rotation.

Why this exists
---------------
RDS stores its master password in an RDS-managed secret and rotates it on a
schedule (every 7 days in production). The application does not read that
secret: both the API task and the one-shot reconciler receive DATABASE_URL by
ECS task-launch injection from a separate, manually maintained secret
(swapify/database-url). Nothing copied the rotated password across, so every
rotation silently invalidated the application copy and took production down
(observed once: ~37.7h, reconciler 100% failure and API health checks failing).

This function closes that gap. It polls on a schedule, notices when the
authoritative RDS secret has moved to a new version, and rewrites only the
password component of the application secret.

Safety model
------------
* The RDS-managed secret is the authoritative source and is READ ONLY here.
  This function's execution role holds no rds:* permission at all, so it
  structurally cannot rotate the database password, modify the instance, or
  write to the authoritative secret.
* Credentials are read into memory and never logged, never returned, never put
  into a metric or an exception message. Log lines carry version ids, counts
  and booleans only.
* Only the password component of the URL is replaced. Scheme, username, host,
  port, database and query string are carried over verbatim from the existing
  application secret, and a malformed application secret aborts the run before
  anything is written.
* Secrets Manager writes are atomic per version: a single PutSecretValue either
  fully succeeds or leaves the current version untouched.
* Idempotent: the run is a no-op whenever the recorded source version already
  matches the authoritative version, so running every 5 minutes forever is safe
  and produces exactly one API redeployment per real rotation.

Rotation-window handling
------------------------
Managed rotation "typically completes within one minute", and during rotation
new readers can briefly observe the previous version. Two independent guards
prevent syncing a half-finished rotation:

1. A settle window - the authoritative secret must not have changed within
   SETTLE_SECONDS.
2. Stability - the authoritative AWSCURRENT version id must be observed
   unchanged across REQUIRED_STABLE_POLLS consecutive polls.

Guard 2 deliberately keys off version id and LastChangedDate only. The
presence of an AWSPENDING staging label is NOT used as a rotation-in-progress
signal, because RDS left a stale AWSPENDING label on this secret that AWS never
cleared; treating it as "rotation active" would block synchronization forever.

ECS propagation
---------------
The reconciler gets a fresh task per scheduled run, so it picks up a new secret
value on its next run with no action. The API is a long-running task with the
value baked in at launch, so it needs a new deployment. After a successful and
verified sync only, this function requests a force-new-deployment of the API
service. The task definition is not changed: this rolls the existing revision
so the replacement task re-reads the secret.
"""

import json
import logging
import os
import time
from datetime import datetime, timezone
from urllib.parse import quote, unquote, urlsplit, urlunsplit

import boto3
from botocore.exceptions import BotoCoreError, ClientError

LOG = logging.getLogger("credential-sync")
LOG.setLevel(logging.INFO)

METRIC_NAMESPACE = os.environ.get("METRIC_NAMESPACE", "Swapify/CredentialSync")
RDS_MASTER_SECRET_ARN = os.environ["RDS_MASTER_SECRET_ARN"]
APP_SECRET_ARN = os.environ["APP_DATABASE_URL_SECRET_ARN"]
STATE_PARAMETER_NAME = os.environ["STATE_PARAMETER_NAME"]
ECS_CLUSTER_NAME = os.environ["ECS_CLUSTER_NAME"]
ECS_SERVICE_NAME = os.environ["ECS_SERVICE_NAME"]

# Do not touch the application secret until the authoritative secret has been
# quiet for this long.
SETTLE_SECONDS = int(os.environ.get("SETTLE_SECONDS", "600"))
# ...and until it has been seen unchanged on this many consecutive polls.
REQUIRED_STABLE_POLLS = int(os.environ.get("REQUIRED_STABLE_POLLS", "2"))

ACCEPTED_SCHEMES = ("postgres", "postgresql")

_sm = boto3.client("secretsmanager")
_ssm = boto3.client("ssm")
_ecs = boto3.client("ecs")
_cw = boto3.client("cloudwatch")


class SyncAborted(Exception):
    """Raised for any condition that must stop the run before anything is written."""


def _emit(name, value, unit="Count"):
    """Publish one metric. Only non-secret scalars are ever passed in."""
    _cw.put_metric_data(
        Namespace=METRIC_NAMESPACE,
        MetricData=[
            {
                "MetricName": name,
                "Value": float(value),
                "Unit": unit,
                "Timestamp": datetime.now(timezone.utc),
            }
        ],
    )


def _authoritative_version():
    """Return (version_id, last_changed_epoch) for the RDS secret's AWSCURRENT.

    Only the staging labels and timestamps are read; the value is not fetched
    here.
    """
    described = _sm.describe_secret(SecretId=RDS_MASTER_SECRET_ARN)
    stages = described.get("VersionIdsToStages", {})
    version_id = None
    for candidate, labels in stages.items():
        if "AWSCURRENT" in labels:
            version_id = candidate
            break
    if version_id is None:
        raise SyncAborted("authoritative secret has no AWSCURRENT version")
    last_changed = described.get("LastChangedDate")
    changed_epoch = last_changed.timestamp() if last_changed else 0.0
    return version_id, changed_epoch


def _load_state():
    try:
        raw = _ssm.get_parameter(Name=STATE_PARAMETER_NAME)["Parameter"]["Value"]
        return json.loads(raw)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ParameterNotFound":
            return {}
        raise


def _save_state(state):
    _ssm.put_parameter(
        Name=STATE_PARAMETER_NAME,
        Value=json.dumps(state, sort_keys=True),
        Type="String",
        Overwrite=True,
    )


def _extract_password(url):
    """Return the decoded password component of a connection URL."""
    return unquote(urlsplit(url).password or "")


def rebuild_url(current_url, authoritative_password):
    """Return current_url with only its password component replaced.

    Everything else - scheme, username, host, port, database, query, fragment -
    is carried over verbatim. Raises SyncAborted rather than producing a
    malformed URL, so a corrupt application secret can never be overwritten
    with something equally corrupt.
    """
    parts = urlsplit(current_url)
    if parts.scheme not in ACCEPTED_SCHEMES:
        raise SyncAborted("application secret scheme is not a postgres URL")
    if not parts.hostname:
        raise SyncAborted("application secret has no host")
    if not parts.username:
        raise SyncAborted("application secret has no username")
    if parts.port is None:
        raise SyncAborted("application secret has no explicit port")
    if parts.path in ("", "/"):
        raise SyncAborted("application secret has no database name")
    netloc = "{user}:{password}@{host}:{port}".format(
        user=quote(parts.username, safe=""),
        password=quote(authoritative_password, safe=""),
        host=parts.hostname,
        port=parts.port,
    )
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def _request_api_redeploy():
    """Roll the API service so the long-running task re-reads the new secret.

    The task definition is untouched. ECS starts the replacement before it
    stops the previous task, so this is an ordinary rolling deployment.
    """
    _ecs.update_service(
        cluster=ECS_CLUSTER_NAME,
        service=ECS_SERVICE_NAME,
        forceNewDeployment=True,
    )


def _poll(force_now=None):
    """One synchronisation poll. Returns a small, credential-free report."""
    now = time.time()
    if force_now is not None:
        now = force_now

    current_version, changed_epoch = _authoritative_version()
    state = _load_state()

    # No drift: nothing to do. This is the overwhelmingly common path.
    if state.get("syncedVersionId") == current_version:
        state["observedVersionId"] = None
        state["observedCount"] = 0
        state["lastHeartbeatEpoch"] = int(now)
        _save_state(state)
        _emit("Heartbeat", 1)
        _emit("DriftDetected", 0)
        _emit("ConsecutiveDriftPolls", 0)
        _emit("Settling", 0)
            # A clean poll must publish zeroes as well as healthy signals.
            # These two metrics are otherwise only ever emitted on the failing
            # path, so their alarms would latch in ALARM permanently after a
            # single transient failure and mask every later occurrence.
        _emit("SyncFailed", 0)
        _emit("ApiRedeployFailed", 0)
        LOG.info(
            "no drift: authoritative version %s already synchronised",
            current_version,
        )
        return {"action": "noop", "authoritativeVersionId": current_version}

    # Drift. Track how many consecutive polls have seen this same version so a
    # rotation in progress is never copied.
    if state.get("observedVersionId") == current_version:
        observed_count = int(state.get("observedCount", 0)) + 1
    else:
        observed_count = 1
    state["observedVersionId"] = current_version
    state["observedCount"] = observed_count
    state["lastHeartbeatEpoch"] = int(now)
    _save_state(state)

    age_seconds = now - changed_epoch
    settling = age_seconds < SETTLE_SECONDS

    _emit("Heartbeat", 1)
    _emit("DriftDetected", 1)
    _emit("ConsecutiveDriftPolls", observed_count)
    _emit("Settling", 1 if settling else 0)

    if settling:
        LOG.info(
            "drift detected on authoritative version %s but it changed %.0fs ago "
            "(settle window %ds); deferring",
            current_version,
            age_seconds,
            SETTLE_SECONDS,
        )
        _emit("SyncFailed", 0)
        return {"action": "settling", "authoritativeVersionId": current_version}

    if observed_count < REQUIRED_STABLE_POLLS:
        LOG.info(
            "drift detected on authoritative version %s, stable for %d/%d polls; deferring",
            current_version,
            observed_count,
            REQUIRED_STABLE_POLLS,
        )
        _emit("SyncFailed", 0)
        return {
            "action": "awaiting_stability",
            "authoritativeVersionId": current_version,
        }

    # Stable and settled: synchronise.
    authoritative = json.loads(
        _sm.get_secret_value(SecretId=RDS_MASTER_SECRET_ARN)["SecretString"]
    )
    authoritative_password = authoritative["password"]
    current_url = _sm.get_secret_value(SecretId=APP_SECRET_ARN)["SecretString"]
    new_url = rebuild_url(current_url, authoritative_password)

    _sm.put_secret_value(SecretId=APP_SECRET_ARN, SecretString=new_url)

    # Verify in memory. The password is compared, never logged.
    written_url = _sm.get_secret_value(SecretId=APP_SECRET_ARN)["SecretString"]
    if _extract_password(written_url) != authoritative_password:
        raise SyncAborted("post-write verification of the application secret failed")

    state["syncedVersionId"] = current_version
    state["observedVersionId"] = None
    state["observedCount"] = 0
    state["lastSyncEpoch"] = int(now)
    state["lastHeartbeatEpoch"] = int(now)
    _save_state(state)

    _emit("SyncSucceeded", 1)
    _emit("DriftDetected", 0)
    _emit("ConsecutiveDriftPolls", 0)
    LOG.info(
        "synchronised application secret from authoritative version %s",
        current_version,
    )

    # Only now, after a verified sync, roll the API so it picks the value up.
    redeployed = True
    try:
        _request_api_redeploy()
        _emit("ApiRedeployRequested", 1)
        _emit("ApiRedeployFailed", 0)
    except (ClientError, BotoCoreError) as exc:
        # The secret is already correct, so the recorded version stays advanced;
        # re-running will not retry the sync. Surface it loudly instead.
        redeployed = False
        _emit("ApiRedeployRequested", 0)
        _emit("ApiRedeployFailed", 1)
        _emit("SyncFailed", 1)
        LOG.error(
            "synchronisation succeeded but the API redeploy request failed (%s); "
            "the API task still holds the previous credential and needs a manual "
            "redeploy",
            type(exc).__name__,
        )
        raise

    return {
        "action": "synchronised",
        "authoritativeVersionId": current_version,
        "apiRedeployRequested": redeployed,
    }


def lambda_handler(event, context):
    try:
        return _poll()
    except (SyncAborted, ClientError, BotoCoreError, KeyError, ValueError) as exc:
        _emit("SyncFailed", 1)
        # type() only: an exception message can embed a connection URL.
        LOG.error("credential sync failed: %s: %s", type(exc).__name__, _safe_detail(exc))
        raise


def _safe_detail(exc):
    """Reduce an exception to something that cannot contain a credential."""
    if isinstance(exc, SyncAborted):
        return str(exc)
    if isinstance(exc, ClientError):
        return exc.response.get("Error", {}).get("Code", "ClientError")
    if isinstance(exc, KeyError):
        # KeyError stringifies its argument, which here would be a JSON key.
        return "missing expected field"
    return type(exc).__name__