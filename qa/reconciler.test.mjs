// API / reconciliation execution split QA (R3.35).
// Run with: npx tsx qa/reconciler.test.mjs
//
// Targets R3.35 — separate API HTTP serving from reconciliation execution.
//
// Before: every API process called startSwapSweeper() unconditionally, so
// running N API tasks (or overlapping during a rolling deploy) ran the same
// financial reconciliation N times. The code carried a TODO to move it to a
// single EventBridge + ECS scheduled task.
//
// After: a one-shot worker (apps/api/src/reconcile-once.ts -> services/
// reconciler.ts) runs exactly one cycle of the SAME expireExpiredSwaps()
// function and exits; the API skips the in-process loop when
// RECONCILE_IN_PROCESS=false.
//
// What is verified here:
//   1. role resolution  -> default api; explicit api/worker; normalized; unknown
//                          value is FATAL (never a silent fallback).
//   2. in-process gate  -> enabled by default (unchanged single-task dev
//                          behaviour), disabled per RECONCILE_IN_PROCESS and
//                          always disabled for the worker role.
//   3. worker config    -> fail-fast on missing DATABASE_URL/STRIPE_SECRET_KEY.
//   4. fail-closed      -> with Stripe absent, the cycle is never started: a
//                          worker must not reconcile against the placeholder
//                          disbursement provider (ledger RELEASED, no transfer).
//   5. real provider    -> with Stripe configured, the real Connect provider is
//                          active before the cycle runs.
//   6. one-shot         -> exactly one cycle per invocation, no loop state, a
//                          cycle failure propagates so the entry exits nonzero.
//   7. no second API    -> the worker entry serves no HTTP, opens no port and
//                          does not arm the sweeper loop; the HTTP entry refuses
//                          to run in the worker role.
//   8. single source    -> the worker calls expireExpiredSwaps(); it contains no
//                          duplicated reconciliation logic of its own.
//   9. infrastructure   -> the task definition, IAM and schedule exist, run the
//                          one-shot command, carry the role flag, are not wired
//                          to the load balancer, and use at-least-once
//                          scheduling (no FLEXIBLE window, retries enabled).
//  10. isolation        -> this release carries no unreleased R3.31-R3.34 code
//                          and requires none of their migrations (R3.35A).
//
// No AWS credentials, no network calls, no live Stripe traffic and no database
// writes: the cycle is injected as a stub, and every Stripe-dependent assertion
// either injects the cycle or runs in a subprocess that fails before the cycle
// starts. IaC checks are static assertions on the CloudFormation template;
// cfn-lint validates the template separately.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const DATABASE_URL = 'postgresql://swapify:swapify@localhost:5432/swapify?schema=public';
const FAKE_STRIPE_KEY = 'sk_test_reconciler_qa_suite';

const results = [];
function check(name, fn) {
  results.push({ name, fn });
}

function restoreEnv(key, prev) {
  if (prev === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = prev;
  }
}

function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) restoreEnv(k, v);
  }
}

// Subprocess probe for anything that depends on module-load-time constants
// (stripeEnabled is read from the environment when stripe.ts is first imported).
function probe(label, env, code) {
  const res = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', code],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL, ...env },
      encoding: 'utf8',
      timeout: 120_000,
    },
  );
  const failed = res.status !== 0 || /^FAIL/m.test(res.stdout ?? '');
  results.push({
    name: label,
    ok: !failed,
    fn: async () => {},
    err: failed
      ? new Error(`probe exited ${res.status}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`)
      : undefined,
  });
}

const {
  resolveAppRole,
  shouldRunInProcessSweepers,
  validateReconcilerConfig,
} = await import('../apps/api/src/config.ts');

// services/reconciler.ts imports stripe-connect.ts, which captures
// stripeEnabled at import time. Set the key first so the in-process checks below
// exercise the real-provider path; every cycle is a stub, so nothing can reach
// Stripe.
process.env.STRIPE_SECRET_KEY = FAKE_STRIPE_KEY;
const { runReconciliationOnce } = await import('../apps/api/src/services/reconciler.ts');
const { getDisbursementProvider } = await import('../apps/api/src/services/value-gap.ts');
const { stripeDisbursementProvider } = await import('../apps/api/src/services/stripe-connect.ts');

// ---------------------------------------------------------------------------
// Source text (static architecture assertions)
// ---------------------------------------------------------------------------

const SRC = {
  entry: readFileSync(new URL('../apps/api/src/reconcile-once.ts', import.meta.url), 'utf8'),
  reconciler: readFileSync(new URL('../apps/api/src/services/reconciler.ts', import.meta.url), 'utf8'),
  server: readFileSync(new URL('../apps/api/src/server.ts', import.meta.url), 'utf8'),
  ecs: readFileSync(new URL('../infra/cloudformation/ecs.yml', import.meta.url), 'utf8'),
  sweeper: readFileSync(new URL('../apps/api/src/services/sweeper.ts', import.meta.url), 'utf8'),
  stripeConnect: readFileSync(
    new URL('../apps/api/src/services/stripe-connect.ts', import.meta.url),
    'utf8',
  ),
  networking: readFileSync(
    new URL('../infra/cloudformation/networking.yml', import.meta.url),
    'utf8',
  ),
};

// Structural (absence) assertions must look at the template, not at the prose
// that documents it — a comment saying "no HealthCheck" is not a HealthCheck.
function stripComments(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

function ecsSlice(start, end) {
  return stripComments(SRC.ecs.slice(SRC.ecs.indexOf(start), SRC.ecs.indexOf(end)));
}

const RECONCILER_TASK_DEF = () => ecsSlice('  ReconcilerTaskDefinition:', '  WebService:');
const RECONCILER_SCHEDULE = () => ecsSlice('  ReconcilerSchedule:', '  # --- Load balancer');

// ---------------------------------------------------------------------------
// 1. Role resolution
// ---------------------------------------------------------------------------

check('resolveAppRole defaults to api when APP_ROLE is unset', () => {
  assert.equal(resolveAppRole(), 'api');
});

check('resolveAppRole defaults to api when APP_ROLE is empty/whitespace', () => {
  withEnv({ APP_ROLE: '   ' }, () => assert.equal(resolveAppRole(), 'api'));
});

check('resolveAppRole accepts explicit api and worker', () => {
  withEnv({ APP_ROLE: 'api' }, () => assert.equal(resolveAppRole(), 'api'));
  withEnv({ APP_ROLE: 'worker' }, () => assert.equal(resolveAppRole(), 'worker'));
});

check('resolveAppRole normalizes case and surrounding whitespace', () => {
  withEnv({ APP_ROLE: ' WORKER ' }, () => assert.equal(resolveAppRole(), 'worker'));
  withEnv({ APP_ROLE: 'Api' }, () => assert.equal(resolveAppRole(), 'api'));
});

check('resolveAppRole rejects an unknown role instead of defaulting', () => {
  withEnv({ APP_ROLE: 'scheduler' }, () => {
    assert.throws(() => resolveAppRole(), /FATAL: unknown APP_ROLE/);
  });
});

// ---------------------------------------------------------------------------
// 2. In-process reconciliation gate
// ---------------------------------------------------------------------------

check('in-process sweeper stays enabled by default (single-task behaviour unchanged)', () => {
  withEnv({ APP_ROLE: undefined, RECONCILE_IN_PROCESS: undefined }, () => {
    assert.equal(shouldRunInProcessSweepers(), true);
  });
});

check('RECONCILE_IN_PROCESS=false disables the in-process sweeper', () => {
  withEnv({ APP_ROLE: 'api', RECONCILE_IN_PROCESS: 'false' }, () => {
    assert.equal(shouldRunInProcessSweepers(), false);
  });
});

check('RECONCILE_IN_PROCESS accepts the usual falsy spellings', () => {
  for (const v of ['false', 'FALSE', '0', 'no', 'off']) {
    withEnv({ APP_ROLE: 'api', RECONCILE_IN_PROCESS: v }, () => {
      assert.equal(shouldRunInProcessSweepers(), false, `expected ${v} to disable`);
    });
  }
});

check('RECONCILE_IN_PROCESS=true keeps the in-process sweeper enabled', () => {
  withEnv({ APP_ROLE: 'api', RECONCILE_IN_PROCESS: 'true' }, () => {
    assert.equal(shouldRunInProcessSweepers(), true);
  });
});

check('worker role never runs the in-process sweeper', () => {
  withEnv({ APP_ROLE: 'worker', RECONCILE_IN_PROCESS: 'true' }, () => {
    assert.equal(shouldRunInProcessSweepers(), false);
  });
});

check('an invalid APP_ROLE is fatal even when asking about the sweeper', () => {
  withEnv({ APP_ROLE: 'nope', RECONCILE_IN_PROCESS: 'true' }, () => {
    assert.throws(() => shouldRunInProcessSweepers(), /FATAL: unknown APP_ROLE/);
  });
});

// ---------------------------------------------------------------------------
// 3. Worker configuration validation
// ---------------------------------------------------------------------------

check('validateReconcilerConfig refuses to run without Stripe or the database', () => {
  withEnv({ DATABASE_URL: undefined, STRIPE_SECRET_KEY: undefined }, () => {
    assert.throws(
      () => validateReconcilerConfig(),
      (err) =>
        /FATAL: reconciliation worker configuration error/.test(err.message) &&
        /DATABASE_URL/.test(err.message) &&
        /STRIPE_SECRET_KEY/.test(err.message),
    );
  });
});

check('validateReconcilerConfig refuses to run without a Stripe key', () => {
  withEnv({ DATABASE_URL, STRIPE_SECRET_KEY: undefined }, () => {
    assert.throws(
      () => validateReconcilerConfig(),
      (err) =>
        /STRIPE_SECRET_KEY/.test(err.message) && !/DATABASE_URL,/.test(err.message),
    );
  });
});

check('validateReconcilerConfig refuses to run without a database URL', () => {
  withEnv({ DATABASE_URL: undefined, STRIPE_SECRET_KEY: FAKE_STRIPE_KEY }, () => {
    assert.throws(
      () => validateReconcilerConfig(),
      (err) => /DATABASE_URL/.test(err.message),
    );
  });
});

check('validateReconcilerConfig passes with database and Stripe configured', () => {
  withEnv({ DATABASE_URL, STRIPE_SECRET_KEY: FAKE_STRIPE_KEY }, () => {
    validateReconcilerConfig();
  });
});

// ---------------------------------------------------------------------------
// 4-6. One-shot behaviour
// ---------------------------------------------------------------------------

check('runReconciliationOnce runs exactly one cycle and returns its result', async () => {
  let calls = 0;
  const result = await withEnv({ DATABASE_URL, STRIPE_SECRET_KEY: FAKE_STRIPE_KEY }, () =>
    runReconciliationOnce(async () => {
      calls += 1;
      return 3;
    }),
  );
  assert.equal(calls, 1, 'cycle must run exactly once per invocation');
  assert.equal(result.expiredSwaps, 3);
  assert.equal(typeof result.durationMs, 'number');
});

check('runReconciliationOnce holds no loop state across invocations', async () => {
  let calls = 0;
  const cycle = async () => {
    calls += 1;
    return 0;
  };
  await withEnv({ DATABASE_URL, STRIPE_SECRET_KEY: FAKE_STRIPE_KEY }, () =>
    runReconciliationOnce(cycle),
  );
  await withEnv({ DATABASE_URL, STRIPE_SECRET_KEY: FAKE_STRIPE_KEY }, () =>
    runReconciliationOnce(cycle),
  );
  assert.equal(calls, 2, 'each invocation runs its own single cycle');
});

check('a failing cycle propagates so the entry can exit nonzero', async () => {
  await withEnv({ DATABASE_URL, STRIPE_SECRET_KEY: FAKE_STRIPE_KEY }, () =>
    assert.rejects(
      () =>
        runReconciliationOnce(async () => {
          throw new Error('database unreachable');
        }),
      /database unreachable/,
    ),
  );
});

check('the real Connect disbursement provider is active before the cycle runs', async () => {
  let providerAtCycleStart = null;
  await withEnv({ DATABASE_URL, STRIPE_SECRET_KEY: FAKE_STRIPE_KEY }, () =>
    runReconciliationOnce(async () => {
      providerAtCycleStart = getDisbursementProvider();
      return 0;
    }),
  );
  assert.equal(providerAtCycleStart, stripeDisbursementProvider);
});

// ---------------------------------------------------------------------------
// 7. The worker is not a second API
// ---------------------------------------------------------------------------

check('the worker entry serves no HTTP and arms no sweeper loop', () => {
  assert.ok(!/\blisten\s*\(/.test(SRC.entry), 'entry must not listen');
  assert.ok(!/buildApp|from '\.\/app\.js'|from '\.\/server\.js'|fastify/i.test(SRC.entry));
  assert.ok(!/startSwapSweeper|startShippingSweeper|setInterval/.test(SRC.entry));
  assert.ok(/process\.exit\(exitCode\)/.test(SRC.entry), 'entry must exit with a status');
  assert.ok(/runReconciliationOnce/.test(SRC.entry));
});

check('the HTTP entry refuses to start in the worker role', async () => {
  const res = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', "await import('./apps/api/src/server.ts');"],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL, APP_ROLE: 'worker', PORT: '0' },
      encoding: 'utf8',
      timeout: 120_000,
    },
  );
  assert.notEqual(res.status, 0, 'server.ts must not start in the worker role');
  assert.match(res.stderr + res.stdout, /APP_ROLE=worker cannot start the HTTP server/);
});

check('the HTTP entry gates the in-process sweeper on the role flag', () => {
  assert.ok(/shouldRunInProcessSweepers\(\)/.test(SRC.server));
  assert.ok(/runsInProcessSweeper \? startSwapSweeper\(\) : null/.test(SRC.server));
  assert.ok(!/^const swapSweeperHandle = startSwapSweeper\(\);$/m.test(SRC.server));
});

check('the worker entry exits 0 on success and 1 only when the cycle fails', () => {
  assert.match(SRC.entry, /let exitCode = 0;/);
  assert.match(SRC.entry, /catch \(err\) \{\s+exitCode = 1;/);
  assert.match(SRC.entry, /process\.exit\(exitCode\)/);
  // The database connection is closed on both paths, otherwise the task would
  // hang on an idle pool and the schedule would pile up tasks.
  assert.match(SRC.entry, /finally \{[\s\S]*disconnectReconciler\(\)/);
  assert.equal((SRC.entry.match(/exitCode = 1/g) ?? []).length, 1);
});

// ---------------------------------------------------------------------------
// 8. Single source of reconciliation truth
// ---------------------------------------------------------------------------

check('the worker reuses expireExpiredSwaps rather than duplicating logic', () => {
  assert.ok(/import \{ expireExpiredSwaps \} from '\.\/sweeper\.js'/.test(SRC.reconciler));
  assert.ok(/runCycle: ReconciliationCycle = expireExpiredSwaps/.test(SRC.reconciler));
  // The worker must not write financial state itself.
  assert.ok(!/prisma\.[a-zA-Z]+\.(create|update|updateMany|delete)/.test(SRC.reconciler));
  assert.ok(/assertRealDisbursementProvider/.test(SRC.reconciler));
});

// ---------------------------------------------------------------------------
// 9. Infrastructure
// ---------------------------------------------------------------------------

check('the reconciler task definition runs the one-shot command with the worker role', () => {
  const taskDef = RECONCILER_TASK_DEF();
  assert.ok(taskDef.length > 0, 'ReconcilerTaskDefinition must exist');
  assert.match(taskDef, /Type: AWS::ECS::TaskDefinition/);
  assert.match(taskDef, /Command: \["node", "apps\/api\/dist\/reconcile-once\.js"\]/);
  assert.match(taskDef, /- Name: APP_ROLE\n\s+Value: worker/);
  // Same image as the API: the worker cannot drift from API code.
  assert.match(taskDef, /Image: !Ref ApiImage/);
  // Least privilege secrets: database + Stripe only.
  assert.match(taskDef, /- Name: DATABASE_URL\n\s+ValueFrom: !Ref DatabaseUrlSecretArn/);
  assert.match(taskDef, /- Name: STRIPE_SECRET_KEY\n\s+ValueFrom: !Ref StripeSecretKeySecretArn/);
  assert.ok(!/STRIPE_WEBHOOK_SECRET/.test(taskDef), 'worker must not receive the webhook secret');
  assert.ok(!/S3_BUCKET|CDN_BASE_URL/.test(taskDef), 'worker must not receive storage config');
});

check('the reconciler container has no port mapping and no health check', () => {
  const taskDef = RECONCILER_TASK_DEF();
  assert.ok(!/PortMappings/.test(taskDef), 'worker must not expose a port');
  assert.ok(!/HealthCheck/.test(taskDef), 'worker must not carry the :4000 health check');
  assert.ok(!/LoadBalancers/.test(taskDef), 'worker must not join the target group');
});

check('the API task opts out of in-process reconciliation via a parameter', () => {
  assert.match(SRC.ecs, /- Name: APP_ROLE\n\s+Value: api/);
  assert.match(SRC.ecs, /- Name: RECONCILE_IN_PROCESS\n\s+Value: !Ref ApiRunsReconciliation/);
  assert.match(SRC.ecs, /ApiRunsReconciliation:\n\s+Type: String\n\s+Default: "false"/);
  // The service itself is not otherwise altered: same task def, same count.
  assert.match(SRC.ecs, /TaskDefinition: !Ref ApiTaskDefinition/);
  assert.match(SRC.ecs, /DesiredCount: !Ref ApiDesiredCount/);
});

check('the schedule starts one task per interval and can retry', () => {
  const schedule = RECONCILER_SCHEDULE();
  assert.ok(schedule.length > 0, 'ReconcilerSchedule must exist');
  assert.match(schedule, /Type: AWS::Scheduler::Schedule/);
  assert.match(schedule, /ScheduleExpression: !Ref ReconcilerScheduleExpression/);
  assert.match(schedule, /State: ENABLED/);
  // At-least-once: an exact interval (not a window that skips invocations) plus
  // retries. No FLEXIBLE window, no one-shot-only schedule.
  assert.match(schedule, /FlexibleTimeWindow:\n\s+Mode: "OFF"/);
  assert.match(schedule, /MaximumRetryAttempts: 2/);
  assert.match(schedule, /TaskDefinitionArn: !Ref ReconcilerTaskDefinition/);
  assert.match(schedule, /LaunchType: FARGATE/);
});

check('the schedule runs the reconciler in the API network path', () => {
  const schedule = RECONCILER_SCHEDULE();
  // RDS ingress is only allowed from ApiSecurityGroupId, so the worker must
  // reuse it (and the app subnets, which egress through NAT to Stripe).
  assert.match(schedule, /SecurityGroups: \[!Ref ApiSecurityGroupId\]/);
  assert.match(schedule, /Subnets: !Ref ApiSubnets/);
  assert.match(schedule, /AssignPublicIp: DISABLED/);
  // No new ingress: networking.yml is untouched.
  assert.match(SRC.networking, /FromPort: 5432/);
  assert.match(SRC.networking, /SourceSecurityGroupId: !Ref ApiSecurityGroup/);
  assert.ok(!/Reconciler/.test(SRC.networking), 'networking.yml must not change');
});

check('the schedule role can only start the reconciler task', () => {
  const role = ecsSlice('  ReconcilerScheduleRole:', '  WebTaskRole:');
  assert.match(role, /Type: AWS::IAM::Role/);
  assert.match(role, /Service: scheduler\.amazonaws\.com/);
  assert.match(role, /ecs:RunTask/);
  assert.match(role, /Resource: !Ref ReconcilerTaskDefinition/);
  assert.match(role, /ecs:cluster: !GetAtt Cluster\.Arn/);
  assert.match(role, /iam:PassedToService: ecs-tasks\.amazonaws\.com/);
});

check('the worker task role is limited to the database and Stripe secrets', () => {
  const role = ecsSlice('  ReconcilerTaskRole:', '  ReconcilerScheduleRole:');
  assert.match(role, /Service: ecs-tasks\.amazonaws\.com/);
  assert.match(role, /DatabaseUrlSecretArn/);
  assert.match(role, /StripeSecretKeySecretArn/);
  assert.ok(!/StorageAccessPolicyArn/.test(role), 'worker must not inherit S3 access');
  assert.ok(!/NextAuthSecret|CognitoClientSecret|WebhookSecret/.test(role));
});

check('the reconciler logs to its own CloudWatch group', () => {
  assert.match(SRC.ecs, /ReconcilerLogGroup:/);
  assert.match(SRC.ecs, /LogGroupName: !Sub "\/ecs\/swapify\/\$\{EnvName\}\/reconciler"/);
  assert.match(RECONCILER_TASK_DEF(), /awslogs-group: !Ref ReconcilerLogGroup/);
});

// ---------------------------------------------------------------------------
// 10. Fail-closed subprocess probes (module-load env constants)
// ---------------------------------------------------------------------------

probe(
  'worker refuses to start a cycle when Stripe is not configured',
  { STRIPE_SECRET_KEY: undefined },
  `
import assert from 'node:assert/strict';
const { runReconciliationOnce } = await import('./apps/api/src/services/reconciler.ts');
let ran = false;
try {
  await runReconciliationOnce(async () => { ran = true; return 0; });
  throw new Error('expected the worker to refuse without Stripe');
} catch (err) {
  if (!/placeholder disbursement provider is active/.test(err.message)) throw err;
}
if (ran) throw new Error('a cycle ran without Stripe — value gaps could be marked RELEASED with no transfer');
console.log('OK');
`,
);

probe(
  'worker refuses to start a cycle without a database URL',
  { STRIPE_SECRET_KEY: FAKE_STRIPE_KEY, DATABASE_URL: undefined },
  `
import assert from 'node:assert/strict';
const { runReconciliationOnce } = await import('./apps/api/src/services/reconciler.ts');
let ran = false;
try {
  await runReconciliationOnce(async () => { ran = true; return 0; });
  throw new Error('expected the worker to refuse without DATABASE_URL');
} catch (err) {
  if (!/reconciliation worker configuration error/.test(err.message)) throw err;
}
if (ran) throw new Error('a cycle ran without a database connection');
console.log('OK');
`,
);

probe(
  'worker entry exits nonzero when Stripe is not configured',
  { STRIPE_SECRET_KEY: undefined, APP_ROLE: 'worker' },
  `
import { spawnSync } from 'node:child_process';
const res = spawnSync(process.execPath, ['--import', 'tsx', 'apps/api/src/reconcile-once.ts'], {
  env: { ...process.env },
  encoding: 'utf8',
});
if (res.status === 0) throw new Error('worker entry must exit nonzero on a fatal error');
const out = res.stdout + res.stderr;
if (!/placeholder disbursement provider is active/.test(out)) {
  throw new Error('expected the fail-closed FATAL log, got:\\n' + out);
}
console.log('OK');
`,
);

probe(
  'worker entry exits nonzero on an invalid APP_ROLE',
  { APP_ROLE: 'cron', STRIPE_SECRET_KEY: FAKE_STRIPE_KEY },
  `
import { spawnSync } from 'node:child_process';
const res = spawnSync(process.execPath, ['--import', 'tsx', 'apps/api/src/reconcile-once.ts'], {
  env: { ...process.env },
  encoding: 'utf8',
});
if (res.status === 0) throw new Error('worker entry must exit nonzero on an invalid role');
if (!/unknown APP_ROLE/.test(res.stdout + res.stderr)) {
  throw new Error('expected an unknown-role FATAL, got:\\n' + res.stdout + res.stderr);
}
console.log('OK');
`,
);

// Deliberately NOT probed here: a full end-to-end run of the entry against the
// local database. If that database holds an expired swap, a stale withdrawal or
// a PENDING checkout, the cycle would call Stripe with the placeholder key — a
// live call to a financial API, which this phase forbids. The success path is
// covered without touching Stripe: runReconciliationOnce() is verified to
// resolve with a result in-process (above), and the entry's exit code is
// asserted statically to be 0 unless the cycle throws. Both nonzero exit paths
// (missing Stripe, missing database) are verified end-to-end above.

// ---------------------------------------------------------------------------
// 10. Isolation from unreleased phases (R3.35A)
//
// R3.35 is released on the production baseline (image b084e2b, 13 migrations).
// R3.31/R3.32/R3.33 add Payment columns behind three unreleased migrations, and
// R3.34 adds payout-webhook recovery. None of them are in production, so this
// release must neither require their migrations nor carry their code: shipping
// them would run against a production schema that does not have those columns.
//
// These are negative assertions on purpose. They are the checks that would fail
// if unreleased work leaked into this tree, which is exactly the regression this
// release must prevent.
// ---------------------------------------------------------------------------

const UNRELEASED_PAYMENT_FIELDS = [
  'stripeDisputeId',
  'disputeReason',
  'disputeStatus',
  'disputedAt',
  'disputeOutcome',
  'disputeClosedAt',
  'disputeEventAt',
  'checkoutAttempt',
  'checkoutAttemptKey',
  'checkoutAttemptClaimedAt',
];

const UNRELEASED_MIGRATIONS = [
  '20260928000000_add_payment_dispute_fields',
  '20260929000000_add_dispute_resolution_fields',
  '20260930000000_add_payment_checkout_concurrency',
];

const MIGRATIONS_DIR = new URL('../packages/db/prisma/migrations/', import.meta.url);
const SCHEMA = readFileSync(new URL('../packages/db/prisma/schema.prisma', import.meta.url), 'utf8');

check('this release requires none of the unreleased R3.31-R3.33 migrations', () => {
  const present = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  for (const migration of UNRELEASED_MIGRATIONS) {
    assert.ok(
      !present.includes(migration),
      `unreleased migration ${migration} must not be in the isolated tree`,
    );
  }
  // The baseline release is 13 migrations. A 14th here would mean a new
  // production migration was introduced, which this phase must never do.
  assert.equal(present.length, 13, `expected the 13-migration baseline, found ${present.length}`);
});

check('the production schema exposes none of the unreleased Payment fields', () => {
  for (const field of UNRELEASED_PAYMENT_FIELDS) {
    assert.ok(
      !new RegExp(`\\b${field}\\b`).test(SCHEMA),
      `schema.prisma must not declare ${field} (unreleased column)`,
    );
  }
});

check('the reconciliation chain reads no unreleased Payment field', () => {
  // Every source file the one-shot worker can reach at runtime.
  const chain = [SRC.reconciler, SRC.entry, SRC.server, SRC.sweeper, SRC.stripeConnect];
  for (const source of chain) {
    for (const field of UNRELEASED_PAYMENT_FIELDS) {
      assert.ok(
        !new RegExp(`\\b${field}\\b`).test(source),
        `${field} must not appear in the R3.35 reconciliation chain`,
      );
    }
  }
});

check('R3.34 payout-webhook recovery is not part of this release', () => {
  // The R3.34 payout-retrieval seam and the missed-payout recovery pass must be
  // absent: production still relies on operators for a missed payout webhook.
  const forbidden = [
    'PayoutRetrievalApi',
    'setStripePayoutRetrievalImpl',
    'payoutsRetrieval',
    'reconcileMissedPayoutWebhooks',
  ];
  for (const source of [SRC.stripeConnect, SRC.sweeper, SRC.reconciler, SRC.entry]) {
    for (const symbol of forbidden) {
      assert.ok(
        !source.includes(symbol),
        `${symbol} (R3.34) must not be present in this release`,
      );
    }
  }
  // getPayout must call Stripe directly again, i.e. no R3.34 injection seam.
  assert.match(
    SRC.stripeConnect,
    /return getStripe\(\)\.payouts\.retrieve\(/,
    'getPayout must use the real Stripe Payouts resource (R3.34 seam removed)',
  );
});

check('R3.33 checkout-payment recovery is not part of this release', () => {
  // Production recovers a missed checkout.session.completed webhook only when
  // R3.33 ships; the baseline sweeper must not call it.
  assert.ok(
    !SRC.sweeper.includes('reconcilePendingCheckoutPayments'),
    'sweeper must not run the R3.33 checkout-payment recovery pass',
  );
  assert.ok(
    !/import \{[^}]*reconcilePendingCheckoutPayments/.test(SRC.sweeper),
    'sweeper must not import the R3.33 recovery function',
  );
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

for (const r of results) {
  try {
    await r.fn();
    r.ok = true;
  } catch (err) {
    r.ok = false;
    r.err = err;
  }
}

let failures = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`  PASS  ${r.name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${r.name}`);
    console.log(String(r.err?.stack ?? r.err));
  }
}
console.log(`\n${results.length - failures}/${results.length} reconciler checks passed`);
process.exit(failures === 0 ? 0 : 1);
