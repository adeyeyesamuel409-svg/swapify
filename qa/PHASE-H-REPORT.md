# PHASE H — FINAL PRE-PRODUCTION AUDIT

**Status: DONE — verification complete**
**Scope:** Full repository audit of Swapify ahead of production go-live,
covering Stripe live config, Connect, money flow, database, financial safety,
webhooks, background jobs, infrastructure, app config, security, testing,
production runbook and live-mode safety.
**Result:** **GO (conditional)** — see Item 12.

> Supersedes / extends `PHASE-G-REPORT.md`. No production source code was
> changed during this audit. Phase D–H work is currently **uncommitted** in the
> working tree (see Item 11).

---

## 1. Executive summary

Swapify's money path — Stripe **Payments** (value-gap charge + 5% service fee,
platform is merchant of record) and **Connect Express** (transfers to connected
accounts, then bank payouts) — is implemented to a high standard of financial
safety. The audit found **no genuine money-safety, authorization, or database
defect that blocks go-live**. The storage model (integer GBP pence), the atomic
conditional state machines, the idempotency keys, the crash-recovery
reconciliation and the P0 refund guards are all correct and verified.

All local automated suites re-passed (objective evidence, Item 6), the schema
and migrations are in sync, no secrets are committed, and typecheck/lint/Prisma
validation are clean. CI enforces build, typecheck, lint and migration-drift
checks on every push.

Go-live is **conditional** on completing the **configuration / operational /
legal** items in Item 12 — none of which is a code defect, and none of which the
code can resolve for you.

---

## 2. Audit coverage & method

Code read (line-referenced), configuration verified, tests re-run:

| Area | Files reviewed |
|---|---|
| Stripe Payments | `services/stripe.ts` |
| Stripe Connect | `services/stripe-connect.ts`, `routes/connect.ts` |
| Withdrawals (money out) | `services/withdrawal.ts`, `routes/withdrawals.ts` |
| Balance ledger | `services/balance.ts`, `routes/balance.ts` |
| Value-gap settlement | `services/value-gap.ts` |
| Swap completion | `services/shipping.ts` (`tryCompleteSwap`) |
| Webhooks | `routes/stripe.ts` |
| Auth / authorization | `plugins/auth.ts`, `app.ts`, all `routes/*` |
| Background jobs | `services/sweeper.ts`, `services/shipping-sweeper.ts` |
| Database | `packages/db/prisma/schema.prisma`, 12 migrations |
| Infrastructure | `infra/cloudformation/ecs.yml`, Dockerfiles, CI pipeline |
| Web app config | `apps/web/src/auth.ts`, `next.config.ts`, Dockerfile |

---

## 3. Findings — no critical / high / medium code defects

No Critical, High, or Medium **code** findings. The findings below are Low,
Operational, or Configuration items that must be actioned at go-live.

---

## 4. Low-severity code findings (non-blocking)

### L-1. Redundant webhook debug log — `routes/stripe.ts:145`
A stray `request.log.debug({ eventType: event.type }, 'Unhandled Stripe webhook
event')` sits **outside** the `switch` (after the `default` case). It fires only
for events that already hit the `default` branch (which already logs the same
message inside its `else`). It is a harmless duplicate log — no behavioural
impact, no money impact. Recommend removing the line as cleanup.

### L-2. Admin stats naming mismatch — `services/balance.ts:251-256`
`getBalanceStats()` returns a `withdrawals` field populated from the generic
DEBIT aggregate rather than specifically `WITHDRAWAL_DEBIT`, and
`totalDebits` counts only `WITHDRAWAL_DEBIT` entries. Today these coincide
(VALUE_GAP_CREDIT is the only credit, withdrawals the only debit) so figures are
correct, but the labels/logic are misleading for future ledger types. Admin-view
only; not a money-safety issue.

### L-3. Dev-only dependency advisories — `npm audit`
`npm audit --omit=dev` reports 3 **high** vulnerabilities in `deepmerge-ts`
(GHSA-ggr8-5vv4-36mx) reachable via `@prisma/config` → `prisma`. This is the
**Prisma CLI**, a `devDependency` that is **not present in the runtime
containers** (both Dockerfiles install with `--omit=dev`). No production
runtime exposure. Recommended: `npm audit fix` in dev / update Prisma when a
fixed release lands. Non-blocking.

---

## 5. Financial-safety verification (positive)

Re-confirmed each invariant in code:

- **Integer GBP pence** everywhere (`Int`); DB-level `CHECK (amountPence > 0)`
  on `BalanceEntry`.
- **No negative balance:** withdrawal debit is an atomic conditional
  `UPDATE ... WHERE availableBalancePence >= amountPence` (TOCTOU-proof).
- **Idempotent money movement:**
  - Payment: `UNIQUE stripeCheckoutSessionId` prevents double-recording.
  - Transfer: deterministic `value-gap-transfer:{valueGapId}` key +
    `externalPayoutRef` guard + conditional persist.
  - Payout: `Withdrawal.idempotencyKey` (`withdrawal:...`) as the Stripe payout
    idempotency key + `UNIQUE stripePayoutId`.
  - Refund: idempotency key `refund-{paymentId}` + conditional
    `WHERE refundedAt IS NULL`.
- **Crash recovery:** `reconcileWithdrawals` (stuck PENDING/PROCESSING +
  out-of-order payout webhooks via `PayoutWebhookObservation`) and
  `reconcileValueGaps` (HELD gaps, missing/incorrect/duplicate credits,
  released-without-transfer retry) are idempotent.
- **P0 refund guard:** `refundSwapPayment` refuses to refund if a transfer
  reversal fails or a RELEASED gap has no transfer ref — preventing net loss.
- **State machines:** ValueGap transitions validated; `RELEASED`/`REFUNDED` are
  terminal; atomic conditional `updateMany` claims prevent double transitions
  under concurrency.
- **Anti-abuse:** `payoutsDisabled`, min/max + daily/weekly/monthly withdrawal
  caps, per-user rate limit on withdrawal creation (10/min), and current-user
  scoping on every balance/withdrawal/connect route (no IDOR).

---

## 6. Test evidence (re-run this audit)

All suites were executed against the local Switchafy Postgres + TEST-mode
Stripe. `NODE_ENV` set to dev/test so simulation is permitted where no live
server is required.

| Suite | Result |
|---|---|
| `npm run typecheck` (api, web, db, shared) | PASS |
| `npm run lint` (api, web, shared) | PASS |
| `prisma validate` | PASS (schema valid) |
| `prisma migrate diff --from-migrations --to-schema-datamodel --exit-code` (with shadow DB) | **No difference detected (exit 0)** — no drift |
| `qa/balance.test.mjs` | **62/62 passed** |
| `qa/value-gap.test.mjs` | **28/28 passed** |
| `qa/withdrawal.test.mjs` | **15/15 passed** |
| `qa/connect.test.mjs` | **17/17 passed** |
| `qa/stripe-connect.test.mjs` | **19/19 passed** |

Combined re-run total: **141/141 local checks passed** (this is on top of the
62 checks and the 47/0/4 automated Phase G suite already documented).

### Secret scan
Searched source for live credentials (`sk_live_`, `pk_`, `AKIA...`, private
keys, `whsec_`): the only hit is **`apps/api/.env`** which contains a
**TEST-mode** key (`sk_test_...`) and is **git-ignored** (verified
`git check-ignore` exit 0, and `git ls-files` shows it untracked). No secrets
are committed.

---

## 7. Webhook coverage

| Stripe event | Handled? | Notes |
|---|---|---|
| `checkout.session.completed` | ✓ | marks Payment PAID, swap AGREED→PAID, allocates ValueGap, creates shipments |
| `account.updated` | ✓ | syncs connected-account status |
| `payout.paid` / `payout.failed` / `payout.canceled` | ✓ | terminal withdrawal transitions; failed/canceled reverse the debit |
| `transfer.failed` | ✓ (default branch) | flags ValueGap for reconciliation |
| `transfer.updated` | ✓ (default, log only) | non-terminal; reconciled by sweeper |
| `charge.dispute.created` | ✓ (default) | flags payment for review |
| `charge.refunded`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `payout.updated`, `transfer.created` | ✗ (no-op / unhandled) | App-driven refunds are recorded directly by `refundSwapPayment`; Dashboard/out-of-band outcomes must be handled manually (see C-3) — **not a go-live blocker for the app-driven flow**. |

The webhook route verifies the HMAC `stripe-signature` against
`STRIPE_WEBHOOK_SECRET` with `constructEvent` (correct).

---

## 8. Infrastructure verification

`infra/cloudformation/ecs.yml` reviewed:

- **Networking:** ALB (internet-facing) SG allows only 443/80 in; API/Web SGs
  ingress only from the ALB SG; egress defaults allow all (fine for Fargate +
  outbound Stripe/DB). `AssignPublicIp: DISABLED`.
- **HTTPS:** 443 listener with ACM cert; 80→443 301 redirect; HSTS header set
  in production.
- **Task security:** `NODE_ENV=production`; `trustProxy` enabled; secrets from
  Secrets Manager with least-privilege IAM (ExecutionRole reads task secrets;
  ApiTaskRole reads only DB + Stripe secrets; WebTaskRole reads only
  NextAuth/Cognito).
- **Health checks:** API `:4000/health`, web `:3000/`, matching the ALB target
  groups and matchers.
- **DB connectivity:** external Postgres reached via `DATABASE_URL` secret; no
  RDS SG is defined in `ecs.yml` — the prod VPC/security group must permit the
  API/Web task SGs (or the DB must be reachable via routing). **Confirm at
  deploy (C-1).**
- **Migrations:** NOT run by the containers. Must be a separate deploy step
  (runbook §1.3). **Operational requirement (C-4).**
- **Sweepers** run on every API instance — idempotent and safe; redundant at
  scale. TODO already in code to move to EventBridge/ECS scheduled task.
- **Rate limiting** (`@fastify/rate-limit`) and in-memory state are per-instance
  (no shared Redis — the Redis container exists but is unused by the API). Fine
  at low scale; note for scale-out.

---

## 9. App & security configuration

- `config.validateConfig()` fails fast in production on missing Stripe keys or a
  `localhost` `WEB_BASE_URL`; simulated checkout is impossible in production.
- Security headers set globally (`X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, HSTS in prod).
- Reliable request logging; graceful shutdown on SIGTERM/SIGINT; sweepers
  stopped and DB disconnected.
- Auth: Cognito access-token JWT verify against remote JWKS with
  `token_use === 'access'` and `client_id` check; only access tokens accepted.
- Every money/balance/withdrawal/connect route is **current-user scoped**
  (`request.user.id`), so no IDOR.

---

## 10. Regulatory & legal (outstanding, external)

- **UK / FCA payment-services regulatory review** of the Connect disbursement
  model (transfers + bank payouts) is **not done** and is required before live
  money leaves the platform (disbursements are intentionally gated pending
  business/legal/FCA review per code comments). **Legal item (L-1), not a code
  defect.**
- Platform is merchant of record for the value-gap charge + service fee — the
  code uses **standard charges + platform-issued transfers** (no Destination
  charges, no application-fee model). This classification is a business/legal
  decision confirmed in code.

---

## 11. Repository state

- The entire Phase D→H production work (Stripe Connect, withdrawals, balance
  ledger, value-gap, shipping, ECS infra, Dockerfiles, migrations, QA suite,
  runbook) is present in the working tree but **uncommitted** (`git status`).
  Last commit `dc9884e`. Recommend committing this work as a discrete
  release before/at go-live.

---

## 12. LIVE-MODE SAFETY matrix

C = Configuration / operational action required before/during go-live.
M = Manual verification in the Stripe LIVE dashboard required.
L = Legal/regulatory review required.

| # | Item | Class | Status |
|---|---|---|---|
| C-1 | Create/provision production RDS/Postgres and confirm ECS task SG → DB connectivity | C | TODO |
| C-2 | Store real `sk_live_`, `whsec_`, `DATABASE_URL`, `NEXTAUTH_SECRET`, `COGNITO_CLIENT_SECRET` in Secrets Manager | C | TODO |
| C-3 | Register production Stripe webhook for the events in §7; set `STRIPE_WEBHOOK_SECRET` | C/M | TODO |
| C-4 | Run `prisma migrate deploy` against prod DB as a mandatory deploy step (not in container) | C | TODO |
| C-5 | Set `WEB_BASE_URL` to the public web domain (fail-closed otherwise) | C | TODO |
| C-6 | Approve/activate Stripe Connect payouts + connected-account setup; configure fee/transfer behavior | C/M | TODO |
| C-7 | Confirm ACM cert covers both domains; DNS points both to the ALB | C | TODO |
| M-1 | TEST another real value-gap transfer + bank payout once the TEST platform has sufficient balance (`balance_insufficient` was the only external blocker in Phase G) | M | BLOCKED-ext |
| M-2 | Verify a live $0-amount + small real charge end-to-end; confirm funds + fee settlement in the Stripe LIVE balance | M | TODO |
| L-1 | UK / FCA legal review of the Connect disbursement + payout model; classify payment activity | L | OUTSTANDING |
| OP-1 | Instrument monitoring (see runbook §5): reconciliation discrepancies, `ANOMALY:` logs, disputes | OP | TODO |

**Legend — outcome of each item:** the only test blocker in Phase G was external
(M-1, TEST platform balance). Everything else is a configuration/operational/legal
action that the codebase cannot perform itself.

---

## 13. Verdict: GO / NO-GO

### **GO (conditional)**

Conditioned on completing the items below (all non-code: configuration,
manual Stripe verification, and legal review):

1. **L-1 UK/FCA legal review** of the Connect disbursement model — **mandatory
   before live money leaves the platform.** No code change can satisfy this.
2. **C-1 … C-7** production configuration (DB, Secrets Manager, webhook
   registration + secret, migrations, `WEB_BASE_URL`, Connect approval, DNS/cert).
3. **M-1/M-2** confirm a real live transfer + payout end-to-end (in TEST first;
   the code path is already verified, only external TEST balance blocked it).
4. **OP-1** stand up monitoring / alerting per the runbook.

**NOT blocking (Low / optional):** L-1, L-2 code cleanup; L-3 dev dependency
advisory; sweeper→scheduled-task refactor (already a TODO).

**Do NOT** migrate to Stripe Accounts V2, remove safety checks, weaken the
financial invariants, or mark the externally-blocked items as PASS.

---

## 14. Files changed by this audit

- `docs/production-runbook.md` — **NEW**, production operations reference.
- No production application code modified.
