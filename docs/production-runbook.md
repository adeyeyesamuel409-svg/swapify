# Swapify Production Runbook

Operational reference for deploying and running Swapify in production. Read this
together with `architecture.md` and the Phase I release-readiness audit report.

Money is handled in **integer GBP pence** (1 pound = 100 pence). Funds flow
through **Stripe Payments** (platform is merchant of record for the value-gap
charge + service fee) and out again via **Stripe Connect Express** (transfers to
connected accounts, then payouts to the user's bank).

---

## 1. Exact deployment sequence

Follow these steps **in order**. Infrastructure provisioning (step 0) must
complete before secrets (step a); steps a–d can then run in parallel by
different team members; step e must complete before step g.

### 0. Provision AWS infrastructure (one-time, CloudFormation)

Deploy the CloudFormation stacks in this order (templates in
`infra/cloudformation/`, parameter files in
`infra/cloudformation/parameters/`). All stacks use `prod` as `EnvName` and
live in `us-east-1` (account 588170396448).

| Order | Stack (`aws cloudformation deploy --stack-name …`) | Template / parameters | Notes |
|---|---|---|---|
| 1 | `swapify-networking` | `networking.yml` + `parameters/prod-networking.json` | VPC `10.0.0.0/16`, public/app/db subnets, 1 NAT (or 3 with `NatGateways=3`), all security groups |
| 2 | `swapify-ecr` | `ecr.yml` + `parameters/prod-ecr.json` | `swapify-api`, `swapify-web` (immutable tags, scan on push) |
| 3 | `swapify-acm` | `acm.yml` + `parameters/prod-acm.json` | `swapifyuk.com` + `api.swapifyuk.com` + `www.swapifyuk.com` (DNS validation). The hosted zone is in this account's Route 53 (`Z020662010TRMMMFK80BU`), so the validation CNAMEs can be created there directly; the stack will sit in `CREATE_IN_PROGRESS` until the records are in place. Run `aws acm describe-certificate --certificate-arn <arn> --region us-east-1` to read the `DomainValidationOptions` CNAMEs (see step g) before continuing |
| 4 | `swapify-rds` | `rds.yml` + `parameters/prod-rds.json` | Fill `VpcId`/`DbSubnetIds`/`RdsSecurityGroupId` from networking stack outputs; PostgreSQL 16, private-only, RDS-managed password secret |
| 5 | `swapify-storage` | `storage.yml` (**already deployed** — do not recreate) | Outputs: `S3Bucket`, `CdnBaseUrl`, `ApiStorageAccessPolicyArn` |
| 6 | `swapify-cognito` | `cognito.yml` (**already deployed** — do not recreate) | Outputs: pool, client, domain, issuer |
| 7 | — | Secrets Manager | Populate the five secrets (step a) |

`swapify-networking` owns **all** security groups (`LoadBalancerSecurityGroupId`,
`ApiSecurityGroupId`, `WebSecurityGroupId`, `RdsSecurityGroupId`). Pass its
outputs to the ECS and RDS stacks — no security groups are defined in `ecs.yml`.
Deploy ECS (`swapify-ecs`, step f) last; it needs networking, ECR URIs, the ACM
certificate ARN, storage/cognito outputs and all five secret ARNs.

### a. Configure production secrets (one-time)

Populate **AWS Secrets Manager** with the five secrets referenced by `ecs.yml`.
The **secret name** is the contract passed as the `*SecretArn` parameters:

| Secret name | Value |
|---|---|
| `swapify/database-url` | Postgres connection string. Build from the RDS stack outputs after step 0: `RdsEndpoint`, `RdsPort` (5432), `RdsDbName`, and the RDS-generated password from `RdsMasterUserSecretArn` (fetch the JSON secret at deploy time, take `.password`; never print it). `postgresql://swapify_app:<password>@<endpoint>:5432/swapify?schema=public` |
| `swapify/stripe/secret-key` | Stripe **live** secret key (`sk_live_...`) |
| `swapify/stripe/webhook-secret` | Webhook signing secret from step b (`whsec_...`) |
| `swapify/web/nextauth-secret` | `openssl rand -base64 32` |
| `swapify/web/cognito-client-secret` | From Cognito pool (step d) |

### b. Configure Stripe LIVE mode (one-time)

1. Create or verify the production Stripe account is set to **live mode**.
2. Enable **Stripe Connect Express**: set capabilities to `transfers` (the code
   creates Express accounts with `type: 'express'`, `capabilities:
   { transfers: { requested: true } }`).
3. Register a **webhook endpoint**:
   - URL: `https://api.swapifyuk.com/stripe/webhook`
   - Events: `checkout.session.completed`, `account.updated`, `payout.paid`,
     `payout.failed`, `payout.canceled`, `transfer.failed`,
     `transfer.updated`, `charge.dispute.created`,
     `charge.dispute.updated`, `charge.dispute.closed`
   - Copy the **signing secret** (`whsec_...`) into Secrets Manager as
     `swapify/stripe/webhook-secret`.
4. Enable Stripe Connect payouts for the account.

### c. Deploy database migrations (CRITICAL — before API deploy)

The **runtime containers do NOT run migrations**. The Dockerfile installs with
`--ignore-scripts` and never executes `prisma migrate deploy`.

```bash
# From a node environment with the DB package built:
npm run build -w @swapify/db
DATABASE_URL="<production-url>" npx prisma migrate deploy \
  --schema packages/db/prisma/schema.prisma
```

After deploying, verify:

```bash
DATABASE_URL="<production-url>" npx prisma migrate status \
  --schema packages/db/prisma/schema.prisma
```

CI runs `prisma migrate diff --from-migrations --to-schema-datamodel
--exit-code` on every build; the exit code must be 0 (no drift).

**New migrations in this release** (all additive, no destructive changes):

| Migration | Purpose |
|---|---|
| `20260819152740` | ValueGap ledger (PENDING/HELD/RELEASED/REFUNDED) |
| `20260819234301` | Balance ledger (BalanceAccount + BalanceEntry) |
| `20260820051328` | BalanceEntry admin audit fields |
| `20260820120000` | CHECK constraint: `amountPence > 0` |
| `20260823133239` | Connect, Withdrawal, PayoutMethod, PayoutWebhookObservation |

**This release (R3.35) adds no database migration.** The reconciliation worker
uses the existing schema exactly as the API does. Production must be at the 13
migrations listed above; `prisma migrate status` must be clean before the stack
is updated, and no `prisma migrate deploy` is part of this release.

### d. Configure Cognito (one-time)

1. Create the Cognito user pool + app client (via `cognito.yml` or manual).
2. Note the `UserPoolId`, `ClientId`, `ClientSecret`, and issuer URL.
3. Store `COGNITO_CLIENT_SECRET` in Secrets Manager as `swapify/web/cognito-client-secret`.
4. Set `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_REGION` in the
   ECS task environment.
5. Production callback and logout URLs are **already configured** on the app
   client (updated via `cognito.yml` in a prior phase): callback
   `https://swapifyuk.com/api/auth/callback/cognito` and logout
   `https://swapifyuk.com`, while the localhost callback/logout URLs remain
   preserved for development.

### e. Build and push Docker images

Tag images with the **immutable git commit SHA** (`ApiImage`/`WebImage`)
matched to the source being released; never use `latest` (ECR repositories
`swapify-api` / `swapify-web` are immutable-tag).

```bash
SHA=$(git rev-parse --short HEAD)
ECR_API=<account>.dkr.ecr.us-east-1.amazonaws.com/swapify-api
ECR_WEB=<account>.dkr.ecr.us-east-1.amazonaws.com/swapify-web

# API
docker build -f apps/api/Dockerfile -t "$ECR_API:$SHA" .
docker push "$ECR_API:$SHA"

# Web (client bundles inline NEXT_PUBLIC_* values at build time, so they must be
# passed as build args; API_URL is passed at build and also set at runtime by ECS)
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_IMAGE_BASE_URL=https://<cloudfront>.cloudfront.net \
  --build-arg NEXT_PUBLIC_API_URL=https://api.swapifyuk.com \
  --build-arg API_URL=https://api.swapifyuk.com \
  -t "$ECR_WEB:$SHA" .
docker push "$ECR_WEB:$SHA"
```

**Web environment split at build time:**
- **Build-time public (`NEXT_PUBLIC_*`)** — inlined into browser bundles, never secrets:
  `NEXT_PUBLIC_IMAGE_BASE_URL`, `NEXT_PUBLIC_API_URL`.
- **Runtime environment** — injected by the ECS task definition: `NEXTAUTH_URL`,
  `COGNITO_CLIENT_ID`, `COGNITO_ISSUER`, `API_URL`.
- **Secrets (runtime, injected from AWS Secrets Manager, never build args):**
  `NEXTAUTH_SECRET`, `COGNITO_CLIENT_SECRET`.
API runtime secrets (`DATABASE_URL`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`) are likewise never baked into images.

### f. Deploy ECS stack

```bash
aws cloudformation deploy --stack-name swapify-ecs \
  --template-file infra/cloudformation/ecs.yml \
  --s3-bucket swapify-cfn-templates-588170396448-us-east-1 \
  --s3-prefix swapify-ecs \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    VpcId=<from swapify-networking> \
    LoadBalancerSubnets=<PublicSubnetIds> \
    ApiSubnets=<AppSubnetIds> WebSubnets=<AppSubnetIds> \
    LoadBalancerSecurityGroupId=<���> ApiSecurityGroupId=<���> WebSecurityGroupId=<���> \
    ApiImage="$ECR_API:$SHA" WebImage="$ECR_WEB:$SHA" \
    ApiDomainName=api.swapifyuk.com WebDomainName=swapifyuk.com \
    CertificateArn=<from swapify-acm> \
    CognitoUserPoolId=<���> CognitoClientId=<���> CognitoIssuer=<���> \
    S3Bucket=<from swapify-storage> CdnBaseUrl=<���> StorageAccessPolicyArn=<���> \
    DatabaseUrlSecretArn=<swapify/database-url ARN> \
    RdsMasterSecretArn=<rds!db-* ARN of the RDS-managed master secret> \
    StripeSecretKeySecretArn=<���> StripeWebhookSecretSecretArn=<���> \
    NextAuthSecretSecretArn=<���> CognitoClientSecretSecretArn=<���>
```

`--s3-bucket` is required, not optional. CloudFormation caps an inline
`TemplateBody` at 51,200 bytes, and this template now embeds the P1.1
credential-sync Lambda source inline and exceeds that limit. Passing `--s3-bucket`
makes the CLI upload the template and reference it by `TemplateURL` instead, which
raises the limit to 1 MB. Without these two flags the deploy fails with
`Template body length cannot exceed 51200 bytes`.

`RdsMasterSecretArn` is new in P1.1 and is required: it is the ARN of the
RDS-managed master secret (the one whose name begins `rds!db-`) and is the
authoritative credential the sync function reads.

`CredentialSyncScheduleExpression` is also new but optional; it defaults to
`rate(5 minutes)`.

The upload bucket (`swapify-cfn-templates-588170396448-us-east-1`) is private,
SSE-encrypted, blocks all public access, and expires uploaded templates after30days.
It holds no application data.

ECS performs a rolling update; the ALB health check gates traffic:

- API: `GET /health` → expect 200
- Web: `GET /` → expect 200

### g. Configure DNS

Point `ApiDomainName` and `WebDomainName` at the ALB DNS name (Route 53 /
A/alias records). The ALB HTTPS listener uses the ACM certificate; HTTP
redirects to HTTPS (301). The domains are hosted **in this account's Route 53**
(hosted zone `swapifyuk.com.` = `Z020662010TRMMMFK80BU`). Complete certificate
validation first: read the CNAMEs from
`aws acm describe-certificate --certificate-arn <arn>` (the `swapify-acm` stack
stays in `CREATE_IN_PROGRESS` until validation), create them in the hosted
zone, wait for the certificate to reach `ISSUED`, then point `swapifyuk.com`
and `api.swapifyuk.com` → ALB `LoadBalancerDnsName`.

**www hostname:** the canonical web hostname is **`https://swapifyuk.com`**
(apex). `www.swapifyuk.com` is included in the certificate SAN and is
redirected to the apex by a dedicated ALB listener rule (`www.swapifyuk.com` →
`https://swapifyuk.com`, HTTP 301, preserving path and query) defined in
`infra/cloudformation/ecs.yml` (`WwwRedirectRule`, priority 30). The rule is
**implemented in the template but its actual AWS effect applies only once the
ECS/ALB stack is deployed** — do not treat the redirect as live until then.
Important: without that dedicated rule, `www.swapifyuk.com` would fall through
to the HTTPS listener's default action and be served by the web target group
under the www hostname rather than erroring. Do not create the
`www.swapifyuk.com` DNS record until the ECS/ALB stack (including the redirect
rule) is deployed. The `swapifyuk.com` / `api.swapifyuk.com` records above
remain dependent on the ALB endpoint existing.

### h. Verify health

1. `curl https://<ApiDomainName>/health` → 200
2. `curl https://<WebDomainName>/` → 200
3. Sign in via the web app, create a test listing, initiate a swap.
4. Check CloudWatch logs for `Swapify API listening` and no `FATAL` lines.

### i. Verify webhook delivery

1. In the Stripe Dashboard → Developers → Webhooks, check the endpoint shows
   recent successful deliveries (200 responses).
2. Trigger a test checkout session; confirm `checkout.session.completed` arrives
   and the Payment transitions to PAID in the database.

### j. Perform controlled live smoke test (FCA/legal approval REQUIRED)

> **GO / NO-GO gate:** Do **not** enable any live money movement (real Stripe
> charges, transfers, or bank payouts) until the **UK/FCA regulatory review and
> any other required legal approval is complete and sign-off is recorded.** The
> money flow is merchant-of-record over GBP value gaps + service fees with
> transfers to connected accounts — confirm this structure is approved before
> step j proceeds with real funds. Until sign-off, limit live operations to
> non-monetary smoke tests.

1. Create a real value-gap swap (£1 minimum) between two test users.
2. Complete the swap (both parties confirm delivery).
3. Verify: Payment PAID → ValueGap HELD → swap COMPLETED → ValueGap RELEASED
   → VALUE_GAP_CREDIT → balance credited.
4. Verify: Stripe transfer created on the recipient's connected account.
5. Request a withdrawal; verify: Withdrawal PENDING → PROCESSING → bank
   payout arrives (or PAYOUT_FAILED → balance restored).

### k. Monitor money-flow invariants

- Watch for `ANOMALY:` lines in CloudWatch (missing/duplicate balance credits,
  wrong recipient, RELEASED gap without transfer).
- Charge-dispute `ANOMALY:` lines are alarmed (see 5.4), not only logged.
- Watch for `BALANCE_RECONCILIATION_MISMATCH`.
- Monitor Stripe Dashboard: platform balance, unsettled transfers/payouts.
- Run `reconcileUserBalance` via the admin endpoint periodically.

### l. Rollback procedure

- **Code:** deploy the previous ECR image. Because payments/withdrawals are
  idempotent and reconciled, rolling back mid-flow is safe — pending states are
  picked up by reconciliation.
- **Schema:** never auto-rollback migrations. Apply a forward-fix migration.

---

## 2. Stripe configuration (one-time, manual)

The API is **fail-closed in production**: missing `STRIPE_SECRET_KEY` /
`STRIPE_WEBHOOK_SECRET`, or a `WEB_BASE_URL` containing `localhost`, refuses
startup (`validateConfig` in `apps/api/src/config.ts`). Simulated checkout is
never enabled in production.

### 2.1 Webhook endpoint

Register a webhook in the Stripe Dashboard (or via `cli listen` for test):

- **Endpoint URL:** `https://api.swapifyuk.com/stripe/webhook`
- **Signing secret:** paste the `whsec_...` into `swapify/stripe/webhook-secret`.
- **Events to subscribe - APPLICATION'S REQUIRED EVENT CONTRACT** (the
  handler in `apps/api/src/routes/stripe.ts` processes these; any others are
  logged as unhandled and are safe no-ops). This lists the events the
  application requires. It does **not** assert that the LIVE Stripe endpoint
  is currently configured with all of them; verifying the LIVE endpoint's
  enabled events is a separate read-only task:
  - `checkout.session.completed`
  - `account.updated`
  - `payout.paid`
  - `payout.failed`
  - `payout.canceled`
  - `transfer.failed`
  - `transfer.updated`
  - `charge.dispute.created`
  - `charge.dispute.updated`
  - `charge.dispute.closed`

### 2.2 Checkout payment

`createSwapPaymentCheckout` creates a Stripe **Checkout Session** (mode
`payment`, GBP) covering `amountPence` (value gap) + `feePence` (5% service
fee). The webhook marks the Payment `PAID` and advances the swap AGREED → PAID.

Charge amounts come exclusively from the server-side Payment row (GBP pence).
Navigating to the success URL never marks a Payment PAID — payment confirmation
is exclusively webhook-driven.

### 2.3 Connect Express onboarding

`createConnectedAccount` creates an **Express** account
(`controller[requirement_collection]` defaults to Stripe's hosted flow) with the
`transfers` capability. Onboarding happens via `createOnboardingLink` (hosted
onboarding URL with `return_url` / `refresh_url` back to Swapify). Express users
complete KYC themselves in Stripe's hosted browser flow.

---

## 3. Connect / withdrawal money flow

1. User completes a swap → ValueGap `HELD → RELEASED` → recipient's internal
   balance credited (`availableBalancePence`). The `stripeDisbursementProvider`
   creates a **Stripe transfer** from the platform balance to the recipient's
   connected account (`value-gap-transfer:{valueGapId}` idempotency key).
2. User requests a withdrawal → a `Withdrawal` (`PENDING`) is created and the
   balance is debited (available→pending) inside a transaction.
3. `createPayout` creates a **payout** on the connected account
   (`withdrawal:{...}` idempotency key). Status → `PROCESSING`.
4. Stripe webhook (`payout.paid/failed/canceled`) moves it to `COMPLETED` or
   reverses the debit on `FAILED`/`CANCELED`. A missed payout webhook is
   recovered by operations, not automatically: confirm the payout status in the
   Stripe Dashboard and act deliberately.
5. On any failure the debit is atomically reversed (`WITHDRAWAL_REVERSAL`) and a
   `WITHDRAWAL_REVERSAL` balance entry is written, so no funds are lost or
   double-spent.

Safety invariants enforced in code:

- No destination charges / application-fee model — the platform is merchant of
  record and issues transfers to connected accounts itself.
- Every transfer & payout is idempotent via a deterministic Stripe idempotency
  key stored in the DB.
- `availableBalancePence` may never go negative: guarded by an atomic
  conditional `UPDATE ... WHERE availableBalancePence >= amount`.
- Balance entries carry a DB-level `CHECK (amountPence > 0)` and a
  `UNIQUE(referenceType, referenceId)` to prevent duplicate credits.
- Refunds on a RELEASED value-gap first reverse the transfer and refuse to
  proceed if the reversal fails (P0 safety guard in `refundSwapPayment`).
- Disabled/restricted connected accounts never receive transfers.

---

## 4. Background jobs (sweepers)

Financial reconciliation runs as a **one-shot task on a schedule**, not inside
the API:

| Component | Runs | Cadence |
| --- | --- | --- |
| `ReconcilerSchedule` (EventBridge Scheduler) → `swapify-reconciler-{env}` | one reconciliation cycle, then exit | `rate(5 minutes)` (`ReconcilerScheduleExpression`) |
| API task (`swapify-api-{env}`) | HTTP only — `RECONCILE_IN_PROCESS=false` | n/a |
| API task | shipping poller (`services/shipping-sweeper.ts`, 60s) | per task, still in-process |

The scheduled task runs `node apps/api/dist/reconcile-once.js` in the same
image as the API. It serves no HTTP, binds no port, has no health check and is
not attached to the target group, so it is not a second API.

`expireExpiredSwaps()` in `services/sweeper.ts` is the single-cycle entry point
used by both the worker and the (optional) in-process loop, so there is one copy
of every rule:

- **Swap expiry** — expires/refunds swaps that never completed.
- **Refund reconciliation** — refunds recorded gap payments for terminal swaps.
- **Shipping deadlines** — cancels shipments that didn't pay for postage /
  dispatch in time (API in-process poller).
- **In-transit polling** — checks carrier tracking; completes swaps on delivery
  (API in-process poller).
- **Withdrawal reconciliation** (`reconcileWithdrawals`) — crash recovery for
  withdrawals stuck without a payout ref, and consumes out-of-order payout
  webhooks.
- **Value-gap reconciliation** (`reconcileValueGaps`) — refunds/releases HELD
  gaps based on authoritative swap/shipment state, and detects anomalies
  (missing/incorrect/duplicate balance credits).
- **Charge-dispute reconciliation** (`reconcileDisputes`) — replays captured
  dispute events that could not be applied on arrival, retries outstanding
  dispute transfer reversals, and surfaces exhausted reversals/open disputes
  as anomalies (see 6.4).

These are the baseline rules plus the R2 charge-dispute reconciliation; R3.35
moves *when* they run and does not add, remove or alter any of them.

### 4.1 Delivery semantics: at-least-once

The schedule fires on an exact interval (`FlexibleTimeWindow.Mode: "OFF"`) and
starts **one** task per interval. This is at-least-once, not exactly-once: a
task can still overlap a slow previous run, can be killed mid-cycle, and is
retried up to twice on failure. All transitions are idempotent conditional
updates (`updateMany` with the eligibility predicate in the `WHERE` clause,
plus Stripe idempotency keys), so a duplicate or partial run is safe. No lock is
used, and none is needed — the schedule is not treated as a mutual-exclusion
mechanism.

### 4.2 Fail-closed behaviour

The worker refuses to run rather than reconcile in a degraded state, and exits
nonzero so the failure is visible in ECS and CloudWatch:

- Missing `DATABASE_URL` or `STRIPE_SECRET_KEY` → fatal before any query.
- Placeholder (non-Stripe) Connect disbursement provider still active → fatal.
  This matters: `reconcileValueGaps()` marks a value gap RELEASED and credits the
  balance *before* notifying the provider, so running without Stripe would
  record a release that no Stripe transfer ever backed.
- Per-item errors (one bad withdrawal, one unreachable carrier) are caught and
  logged, and the cycle continues — one bad item never aborts the batch.

### 4.3 Deployment order (important)

`ApiRunsReconciliation` controls the API-side flag. Deploy in two steps so
reconciliation is never unowned:

1. Deploy the stack with `ApiRunsReconciliation=true`. This creates the
   reconciler task definition and the schedule while the API keeps sweeping as
   before — duplicate work for a few minutes, which is safe.
2. Confirm the schedule is firing and the worker is succeeding (see 5.1).
3. Update the stack with `ApiRunsReconciliation=false`. The API logs
   `In-process reconciliation disabled` at startup and now serves HTTP only.

Never set `ApiRunsReconciliation=false` before step 1: with no working schedule,
all reconciliation stops and nothing retries until someone notices.

### 4.4 Manual overrides

`POST /admin/value-gaps/reconcile` (moderator) still calls
`reconcileValueGaps()` directly. It is an operator escape hatch, not a runner:
it executes once per request and is safe to use while the schedule is running,
because the same conditional updates apply. Keep it for incidents.

### 4.5 Running a cycle by hand

```bash
# One cycle, using the same env the task receives. Exits 0 on success.
cd apps/api && npm run reconcile:once
```

For a dry check against production data, run it from a trusted host with the
same secrets the task uses; it makes real Stripe reads and writes exactly like
the scheduled task.

---

## 5. Monitoring & alerting

### 5.1 Health checks

- API: `GET /health` (ALB target group).
- Web: `GET /` (ALB target group).
- ECS task health check on the API also hits `:4000/health`.

### 5.2 Logs

- API: CloudWatch `/ecs/swapify/{env}/api`
- Web: CloudWatch `/ecs/swapify/{env}/web`
- Reconciler: CloudWatch `/ecs/swapify/{env}/reconciler`
- Structured JSON (pino). Watch for:
  - `ANOMALY:` lines from value-gap/balance reconciliation (missing or
    duplicate balance credits, wrong recipient, RELEASED gap without a
    transfer).
  - `BALANCE_RECONCILIATION_MISMATCH` errors.
  - `Transfer failed`, `Payout failed`, `refund ... aborting refund for
    safety`, `Unhandled Stripe webhook event`.
  - `FATAL: one-shot reconciliation failed` in the reconciler log group — the
    task exited nonzero and the schedule retried it.
  - `ANOMALY:` dispute lines (see 6.4) are **alarmed**, not just logged —
    see 5.4.
  - `In-process reconciliation disabled` in the API log group — expected in
    production; its **absence** while `ApiRunsReconciliation=false` means the
    stack is out of sync with the parameter.

### 5.3 Financial reconciliation

- **Confirm the schedule is alive.** A stopped schedule is silent: no work is
  queued, nothing errors, and financial state simply ages. Check every few hours
  (or alert on it) that the reconciler log group has a new
  `Reconciliation cycle complete` line within ~2 intervals:

  ```bash
  aws logs tail "/ecs/swapify/prod/reconciler" --since 15m \
    --filter-pattern "Reconciliation cycle complete"
  ```

  Also alert on `ReconciliationSchedule-TargetExecutionFailed` for the
  `swapify-reconciler-{env}` schedule.
- Periodically run `reconcileUserBalance` (via the admin endpoint) and check
  the discrepancy is 0.
- Monitor the Stripe Dashboard: platform balance vs the sum of internal
  balances, unsettled transfer/payout states, and any charge disputes.

### 5.4 Dispute anomaly alarms

R3.1 derives metrics from the dispute `ANOMALY:` / replay-failure log lines
that charge-dispute handling already emits (6.4). The filters run on **both**
`/ecs/swapify/{env}/api` and `/ecs/swapify/{env}/reconciler`, because the same
lines can be produced by the API's webhook path and by the reconciler's
replay/retry path (and by in-process sweeping while
`ApiRunsReconciliation=true`). Namespace: `Swapify/{env}/DisputeAnomalies`.

| Alarm | Fires when |
| --- | --- |
| `swapify-{env}-dispute-reversal-exhausted` | reversal retries hit the ceiling; funds not clawed back |
| `swapify-{env}-dispute-reversal-failed` | a transfer reversal attempt failed (reconciler retries it) |
| `swapify-{env}-dispute-multiple-disputes` | a second dispute claimed a payment already owned by another |
| `swapify-{env}-dispute-claim-lost` | a dispute claim did not survive read-back (should be impossible) |
| `swapify-{env}-dispute-released-no-external-payout` | RELEASED gap disputed with no recorded transfer reference |
| `swapify-{env}-dispute-replay-failure` | a captured dispute event could not be replayed, or a reversal could not be retried |

All of them: `Sum >= 1` over one 300s period, `TreatMissingData=notBreaching`
(a quiet window is healthy - silence is covered by the reconciler
missing-execution alarm in 5.3).

`DisputeFrozenActionRefused` is **metric-only, deliberately not alarmed**: a
frozen-payment release/refund refusal means the guard worked and no money
moved. It is dashboard material, not a page.

**Every alarm publishes to `swapify-reconciliation-alerts-{env}`, the existing
reconciliation SNS topic, which has no subscription** - there is no confirmed
operator recipient, and none was invented for this phase. Until an operator
attaches one, these alarms are visible only through the CloudWatch console and
CLI:

```bash
aws cloudwatch describe-alarms \
  --alarm-names "swapify-prod-dispute-reversal-exhausted" \
  --query 'MetricAlarms[].{name:AlarmName,state:StateValue}'
```

Attaching a subscription (email/Slack/PagerDuty) is an operator decision and a
separate change.

---

## 6. Incident response

### 6.1 Withdrawal stuck in `PENDING`/`PROCESSING` without a payout ID

`reconcileWithdrawals` retries with the same idempotency key. If it stays stuck,
investigate the connected-account balance (the most common cause is
`balance_insufficient`). Once funds are available it completes automatically.

### 6.1b Withdrawal stuck in `PROCESSING` with a payout ID (missed webhook)

Reconciliation does not guess at a missed payout webhook. Confirm the payout's
authoritative status in the Stripe Dashboard; if it is terminal, drive the
withdrawal through the same path the webhook would have used (never by editing
the row directly), or apply the reversal in 6.2 deliberately. Treat it as a
financial incident.

### 6.2 Stripe payout failed

The debit is reversed automatically and the balance restored
(`WITHDRAWAL_REVERSAL`). Tell the user to correct their bank details / verify
their account, then request again. Never manually re-run a payout without
confirming whether the original succeeded (use the idempotency key).

### 6.3 Refund stuck / RELEASED gap

If a refund is refused for safety (RELEASED gap without a transfer ref, or a
failed transfer reversal), treat it as a **financial incident**. Locate the
transfer reversal / transfer in the Stripe Dashboard, reconcile, and only then
refund. Do not bypass the guard programmatically.

### 6.4 Charge dispute

**This section documents behavior already implemented in source
(`apps/api/src/routes/stripe.ts`, `apps/api/src/services/disputes.ts`,
`apps/api/src/services/value-gap.ts`, `apps/api/src/services/stripe.ts`).**

The application processes `charge.dispute.created`, `charge.dispute.updated`
and `charge.dispute.closed` webhooks. Dispute handling is **not** refund
handling: `dispute != refund`.

#### Webhook intake (all three event types)

1. **Signature verification.** Every `POST /stripe/webhook` request is verified
   against the `stripe-signature` header using the raw request body
   (`request.rawBody`) and the `stripe/webhook-secret` value. A request that
   fails verification is rejected before any dispute logic runs.
2. **Durable observation capture.** Before any state transition, the event is
   recorded durably in `DisputeEventObservation` (keyed by
   `stripeEventId`) so a crash or a Stripe redelivery can never lose it.
   Capture is idempotent: a redelivered `stripeEventId` is a no-op.
3. **Dispute/payment linkage.** The dispute's `paymentIntentId` is resolved to
   the local `Payment` row; `Payment.stripeDisputeId` is set (unique) to bind
   exactly one dispute to a payment. A second, different dispute for the same
   payment is rejected and logged as the `MULTIPLE_DISPUTES` anomaly.
4. **Duplicate handling.** An event already applied for the same
   `stripeEventId` returns `DUPLICATE` and performs no additional writes.
5. **Stale-event handling.** An event whose `eventCreated` predates the
   payment's recorded `disputeEventAt` is ignored (`OUT_OF_ORDER`) so older
   events replayed after newer ones cannot roll state backwards.
6. **Failure propagation.** Any recognized dispute processing failure returns
   a non-2xx (500) response. Stripe treats non-2xx as a failure and can
   redeliver; because the event was already durably captured, redelivery and
   later replay are idempotent.

#### Event-specific behavior

- **`charge.dispute.created`** - the payment is claimed for the dispute
  (`stripeDisputeId` written) and enters the frozen state. If the linked
  `ValueGap` is `RELEASED`, a transfer reversal is initiated (see "RELEASED
  ValueGap dispute handling" below). No refund state is written.
- **`charge.dispute.updated`** - the dispute status is advanced. When Stripe
  reports a terminal outcome, the final outcome is latched exactly once
  (`disputeOutcome`): `WON`/`PREVENTED` unfreeze the payment; `LOST`/`UNKNOWN`
  keep it frozen for manual review. Non-terminal updates keep the payment
  frozen.
- **`charge.dispute.closed`** - the terminal outcome is latched exactly once.
  `WON`/`PREVENTED` unfreeze the payment (no refund, no release was performed
  by this handler). `LOST`/`UNKNOWN` leave the payment frozen; the funds are
  treated as gone and the case requires manual review. The latch is
  idempotent: a redelivered close event cannot re-latch a different outcome.

#### Frozen payment behavior

While a payment is dispute-frozen (`stripeDisputeId` set and `disputeOutcome`
not `WON`/`PREVENTED`):

- `releaseValueGap()` refuses to release the gap and credits no balance
  (`ANOMALY: refusing to release ValueGap — charge dispute is open ...`).
- `refundValueGap()` refuses to mark the gap `REFUNDED`
  (`ANOMALY: refusing to mark ValueGap REFUNDED — charge dispute is open ...`).
- `refundSwapPayment()` refuses to create a Stripe refund
  (`ANOMALY: refusing to refund a payment with an open charge dispute ...`).

These refusals leave internal financial state untouched. When the dispute
closes as `WON` or `PREVENTED`, the freeze predicate no longer holds and the
payment is unfrozen in line with the terminal outcome.

#### `refundedAt` / `stripeRefundId` semantics

`Payment.refundedAt` and `Payment.stripeRefundId` are written **only** by
`refundSwapPayment()` after a confirmed Stripe Refund object exists (the value
is always a `re_...` refund id, never a `dp_...` dispute id). They represent a
**confirmed Stripe Refund only**. Dispute webhook processing never writes them.

**Stripe dispute events do NOT create ordinary Stripe Refunds.**

#### RELEASED ValueGap dispute handling

When a dispute is claimed against a payment whose `ValueGap` is `RELEASED`:

- If `externalPayoutRef` (the Stripe transfer id) exists, a transfer reversal
  is attempted through the pre-existing, idempotent `reverseTransfer()` path
  using the deterministic idempotency key `transfer-reversal:{valueGapId}`.
  Retries are bounded (`MAX_DISPUTE_REVERSAL_ATTEMPTS`, currently 3). An
  exhausted reversal is logged as `ANOMALY: dispute transfer reversals
  exhausted all attempts ...` (`DISPUTE_REVERSAL_EXHAUSTED`) and requires
  manual intervention.
- If `externalPayoutRef` is missing, no reversal is attempted and the
  `ANOMALY: dispute against a RELEASED ValueGap with no externalPayoutRef ...`
  (`DISPUTED_RELEASED_NO_EXTERNAL_PAYOUT`) anomaly is logged for manual review;
  the transfer state on Stripe is unknown and must be verified by an operator.
- **No internal balance debit is performed by dispute reversal.** The
  recipient's internal balance is deliberately left unchanged; clawback is the
  Stripe transfer reversal's responsibility only.

#### Replay / reconciliation

`reconcileDisputes()` runs inside `expireExpiredSwaps()` in
`apps/api/src/services/sweeper.ts`, as the **final reconciliation step** of
each cycle: after swap expiry, `reconcileRefunds()`, `reconcileValueGaps()`
and `reconcileWithdrawals()`. It:

1. Replays unconsumed `DisputeEventObservation` rows (deferred observations,
   and events whose application previously failed) by re-applying them through
   the same idempotent processing path. Replay attempts are bounded
   (`MAX_DISPUTE_OBSERVATION_ATTEMPTS`, currently 5) so an unmatched charge
   cannot spin forever. An observation that still cannot be applied logs
   `Failed to replay captured dispute event` (`DISPUTE_REPLAY_FAILURE`) and
   requires manual review.
2. Retries outstanding `PENDING`/`FAILED` transfer reversals under the same
   idempotency key (a failure logs `Failed to retry dispute transfer reversal`).
3. Surfaces exhausted reversals and open disputes as one-line `ANOMALY`/WARN
   logs for operators.

Unconsumed dispute observations are replayed on each cycle until applied or
until the bounded attempt limit marks them for manual review.

#### Manual-resolution cases

An operator must investigate and resolve these before further disbursement:

- `DISPUTE_REVERSAL_EXHAUSTED` - reversal retry ceiling reached; transfer not
  clawed back.
- `MULTIPLE_DISPUTES` - a second dispute attempted to claim a payment already
  bound to another dispute.
- `DISPUTED_RELEASED_NO_EXTERNAL_PAYOUT` - a `RELEASED` gap is disputed but has
  no `externalPayoutRef`, so the external reversal cannot be verified/safely
  executed.
- `UNKNOWN`/`LOST` dispute with funds frozen - terminal outcome left the
  payment frozen with no path back; the funds situation must be assessed in the
  Stripe Dashboard.
- `DISPUTE_REPLAY_FAILURE` - a captured dispute observation cannot be applied
  during reconciliation.

Every trigger above is alarmed by the metric filters in 5.4 (namespace
`Swapify/{env}/DisputeAnomalies`), which publish to
`swapify-reconciliation-alerts-{env}`.

**Important:** Stripe dispute events do **not** create ordinary Stripe Refunds.
Any financial remediation must follow the dispute lifecycle above and only
create a Stripe Refund via the sanctioned refund path (`refundSwapPayment`)
after a confirmed Stripe Refund object exists. Never infer a refund or release
from a dispute event.

### 6.5 Reconciliation stopped (no recent cycles in the reconciler log group)

The scheduled reconciler is a one-shot task, so a broken schedule produces no
error anywhere — state simply ages. Symptoms: expired swaps not expiring,
withdrawals stuck in `PROCESSING`, HELD value gaps not released.

1. Check the schedule exists and is enabled: `aws scheduler get-schedule --name
   swapify-reconciler-prod`.
2. Check the task is starting at all: `aws logs tail
   "/ecs/swapify/prod/reconciler" --since 1h`.
3. `FATAL: one-shot reconciliation failed` → read the error. A
   `placeholder disbursement provider` FATAL means the task is missing
   `STRIPE_SECRET_KEY` (or its task role lost secret access); do **not** work
   around it, fix the secret.
4. No logs at all → the schedule is not firing or the task definition is
   invalid. Confirm the task definition registered
   (`aws ecs describe-task-definition --task-definition swapify-reconciler-prod`).
5. **Fastest safe mitigation:** redeploy the API stack with
   `ApiRunsReconciliation=true` so the in-process loop resumes reconciliation
   while the schedule is fixed. Duplicate work during the overlap is safe (every
   transition is an idempotent conditional update). Do not leave it that way —
   the duplicate execution is what this split exists to remove.

### 6.6 Rollback

- **Code:** deploy the previous ECR image. Because payments/withdrawals are
  idempotent and reconciled, rolling back mid-flow is safe — pending states are
  picked up by reconciliation.
- **Schema:** never auto-rollback migrations. Apply a forward-fix migration.

---

## 7. Getting help / escalation

- Open financial anomalies as high-priority issues; attach the CloudWatch log
  lines and the relevant Stripe object IDs.
- Escalate any `ANOMALY:` or reconciliation mismatch to the money-flow owners
  before proceeding with further disbursements/refunds.
