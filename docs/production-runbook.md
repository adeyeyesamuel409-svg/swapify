# Swapify Production Runbook

Operational reference for deploying and running Swapify in production. Read this
together with `architecture.md` and the Phase I release-readiness audit report.

Money is handled in **integer GBP pence** (1 pound = 100 pence). Funds flow
through **Stripe Payments** (platform is merchant of record for the value-gap
charge + service fee) and out again via **Stripe Connect Express** (transfers to
connected accounts, then payouts to the user's bank).

---

## 1. Exact deployment sequence

Follow these steps **in order**. Steps a–d can be done in parallel by
different team members; step e must complete before step g.

### a. Configure production secrets (one-time)

Populate **AWS Secrets Manager** with the five secrets referenced by `ecs.yml`:

| Secret | Value |
|---|---|
| `DATABASE_URL` | Postgres connection string (`postgresql://...?schema=public`) |
| `STRIPE_SECRET_KEY` | Stripe **live** secret key (`sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret from step b (`whsec_...`) |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `COGNITO_CLIENT_SECRET` | From Cognito pool (step d) |

### b. Configure Stripe LIVE mode (one-time)

1. Create or verify the production Stripe account is set to **live mode**.
2. Enable **Stripe Connect Express**: set capabilities to `transfers` (the code
   creates Express accounts with `type: 'express'`, `capabilities:
   { transfers: { requested: true } }`).
3. Register a **webhook endpoint**:
   - URL: `https://<ApiDomainName>/stripe/webhook`
   - Events: `checkout.session.completed`, `account.updated`, `payout.paid`,
     `payout.failed`, `payout.canceled`, `transfer.failed`, `transfer.updated`,
     `charge.dispute.created`
   - Copy the **signing secret** (`whsec_...`) into Secrets Manager as
     `STRIPE_WEBHOOK_SECRET`.
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

### d. Configure Cognito (one-time)

1. Create the Cognito user pool + app client (via `cognito.yml` or manual).
2. Note the `UserPoolId`, `ClientId`, `ClientSecret`, and issuer URL.
3. Store `COGNITO_CLIENT_SECRET` in Secrets Manager.
4. Set `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_REGION` in the
   ECS task environment.

### e. Build and push Docker images

```bash
# API
docker build -f apps/api/Dockerfile -t $ECR/api:latest .
docker push $ECR/api:latest

# Web (requires NEXT_PUBLIC_IMAGE_BASE_URL set at build time if using CDN)
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_IMAGE_BASE_URL=https://<cloudfront>.cloudfront.net \
  -t $ECR/web:latest .
docker push $ECR/web:latest
```

### f. Deploy ECS stack

Update the CloudFormation stack with the new `ApiImage` / `WebImage` parameters.
ECS performs a rolling update; the ALB health check gates traffic:

- API: `GET /health` → expect 200
- Web: `GET /` → expect 200

### g. Configure DNS

Point `ApiDomainName` and `WebDomainName` at the ALB DNS name (Route 53 /
CNAME). The ALB HTTPS listener uses the ACM certificate; HTTP redirects to
HTTPS (301).

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
- Watch for `BALANCE_RECONCILIATION_MISMATCH`.
- Monitor Stripe Dashboard: platform balance, unsettled transfers/payouts,
  charge disputes.
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

- **Endpoint URL:** `https://<ApiDomainName>/stripe/webhook`
- **Signing secret:** paste the `whsec_...` into `STRIPE_WEBHOOK_SECRET`.
- **Events to subscribe** (the handler in `apps/api/src/routes/stripe.ts`
  processes these; any others are logged as unhandled and are safe no-ops):
  - `checkout.session.completed`
  - `account.updated`
  - `payout.paid`
  - `payout.failed`
  - `payout.canceled`
  - `transfer.failed`
  - `transfer.updated`
  - `charge.dispute.created`

### 2.2 Checkout payment

`createSwapPaymentCheckout` creates a Stripe **Checkout Session** (mode
`payment`, GBP) covering `amountPence` (value gap) + `feePence` (5% service
fee). The webhook marks the Payment `PAID` and advances the swap AGREED → PAID.

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
   reverses the debit on `FAILED`/`CANCELED`.
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

The API runs in-process sweepers (`services/sweeper.ts`,
`services/shipping-sweeper.ts`) plus `reconcileWithdrawals` and
`reconcileValueGaps`:

- **Swap expiry** — expires/refunds swaps that never completed.
- **Shipping deadlines** — cancels shipments that didn't pay for postage /
  dispatch in time.
- **In-transit polling** — checks carrier tracking; completes swaps on delivery.
- **Withdrawal reconciliation** (`reconcileWithdrawals`) — crash recovery for
  withdrawals stuck without a payout ref, and consumes out-of-order payout
  webhooks.
- **Value-gap reconciliation** (`reconcileValueGaps`) — refunds/releases HELD
  gaps based on authoritative swap/shipment state, and detects anomalies
  (missing/incorrect/duplicate balance credits).

All transitions are **idempotent and concurrency-safe** (atomic conditional
`updateMany` claims + Stripe idempotency keys), so it is safe for multiple API
instances to run them. It is redundant but harmless; the code carries a TODO to
move sweepers to a single ECS **scheduled task / EventBridge** in production to
avoid N× redundant work.

---

## 5. Monitoring & alerting

### 5.1 Health checks

- API: `GET /health` (ALB target group).
- Web: `GET /` (ALB target group).
- ECS task health check on the API also hits `:4000/health`.

### 5.2 Logs

- API: CloudWatch `/ecs/swapify/{env}/api`
- Web: CloudWatch `/ecs/swapify/{env}/web`
- Structured JSON (pino). Watch for:
  - `ANOMALY:` lines from value-gap/balance reconciliation (missing or
    duplicate balance credits, wrong recipient, RELEASED gap without a
    transfer).
  - `BALANCE_RECONCILIATION_MISMATCH` errors.
  - `Transfer failed`, `Payout failed`, `refund ... aborting refund for
    safety`, `Unhandled Stripe webhook event`.

### 5.3 Financial reconciliation

- Periodically run `reconcileUserBalance` (via the admin endpoint) and check
  the discrepancy is 0.
- Monitor the Stripe Dashboard: platform balance vs the sum of internal
  balances, unsettled transfer/payout states, and any charge disputes.

---

## 6. Incident response

### 6.1 Withdrawal stuck in `PENDING`/`PROCESSING` without a payout ID

`reconcileWithdrawals` retries with the same idempotency key. If it stays stuck,
investigate the connected-account balance (the most common cause is
`balance_insufficient`). Once funds are available it completes automatically.

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

`charge.dispute.created` flags the payment (`refundedAt` set). Review the
dispute in the Stripe Dashboard. Responses and `funds_withdrawn` / `closed`
outcomes must be handled manually in the operations process until webhook
handlers are extended (see audit report).

### 6.5 Rollback

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
