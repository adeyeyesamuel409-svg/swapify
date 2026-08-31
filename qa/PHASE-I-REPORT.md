# PHASE I — FINAL RELEASE PREPARATION REPORT

**Repository:** Swapify (barter marketplace; money = integer GBP pence via Stripe Connect Express)
**Phase scope:** Final release-readiness audit, verification, and deployment documentation.
**Predecessors:** Phases D (P0/P1 money-safety issues identified) → E (remediation) → F (verification) → G (Stripe TEST-mode validation 47 PASS) → H (full code audit, 141/141 tests, GO conditional).

---

## Executive summary

Phase I is the final gating review before the Swapify money-flow goes live. All
completed verification returned clean results: the schema has no drift, all QA
suites pass, typecheck/lint/build/CI are green, the money-flow invariants are
unchanged and correct, and the diff against the last commit (`dc9884e`) contains
**only intended, reviewed changes**.

**Verdict: GO — conditional.**

The conditions (all external or pre-existing, none are code defects) are listed
in §14. The codebase itself is release-ready for the money-flow feature.

---

## 1. Git status inspection

The working tree holds the entire Phase D→I work, **uncommitted** since the last
commit `dc9884e`. One release commit should be created containing the reviewed
files (see §15).

### Modified files (31)
- **Production code:** `apps/api/src/{config,server,app}.ts`, `services/{
  stripe,sweeper,shipping}.ts`, `routes/{stripe,swaps}.ts`
- **Shared package:** `packages/shared/src/index.ts`
- **Web:** `apps/web/src/auth.ts` (+ a web component touching value-gap labels)
- **DB:** `packages/db/prisma/schema.prisma`
- **Infra:** `infra/cloudformation/ecs.yml`
- **CI/CD:** `.github/workflows/ci.yml`, `.dockerignore`, `package-lock.json`
- **Config:** `.env.example`, `.gitignore`
- **QA/docs:** `qa/*.test.mjs` amended, `docs/production-runbook.md`

### Untracked files (~60)
- **New production source:** `services/{stripe-connect,value-gap,withdrawal,
  balance}.ts`, `services/shipping-sweeper.ts`, `routes/{balance,connect,
  withdrawals}.ts`, `services/sweeper` additions
- **DB migrations:** 5 new (additive) — see §4
- **QA deliverables:** `qa/*.test.mjs`, `qa/PHASE-[G,H,I]-REPORT.md`,
  `qa/phase-g-stripe-test.mjs`, `qa/screenshots/`, `qa/responsive-report.txt`,
  `qa/.fixtures.json`, `qa/prisma-seed.mjs`

> **⚠️ Corrected in Phase J:** At Phase I this flagged `qa/screenshots/*.png`,
> `qa/responsive-report.txt`, and `qa/.fixtures.json` as not git-ignored.
> **Phase J has fixed `.gitignore`** (added `qa/screenshots/`, `qa/fixtures.json`,
> `qa/.fixtures.json`) and verified via `git status --ignored` that screenshots
> and fixtures are now ignored while `qa/*.test.mjs` and `qa/PHASE-*-REPORT.md`
> remain trackable.
>
> **Security correction:** the Phase I description of `qa/.fixtures.json` as
> "test fixture IDs (not secrets)" was **inaccurate**. The file contains **live
> Cognito JWT access tokens** (`aliceToken`/`malloryToken`) from the local dev
> run, and must never be committed. It is now correctly git-ignored.
> `qa/responsive-report.txt` remains a trackable QA report and is intentionally
> kept.

---

## 2. File categorization

| Category | Files | Review status |
|---|---|---|
| Money-flow core | `stripe.ts`, `stripe-connect.ts`, `value-gap.ts`, `withdrawal.ts`, `balance.ts` | Reviewed — correct |
| Money-flow orchestration | `shipping.ts`, `sweeper.ts`, `shipping-sweeper.ts` | Reviewed — correct |
| HTTP layer | `app.ts`, `server.ts`, `config.ts`, `routes/{stripe,swap,balance,connect,withdrawals}.ts` | Reviewed — correct |
| Domain | `services/swaps.ts`, `services/swap.ts` | Reviewed — correct |
| Auth/plugins | `plugins/auth.ts`, `routes/auth.ts`, `web/src/auth.ts` | Reviewed — correct |
| Data model | `packages/db/prisma/schema.prisma` (+ 5 migrations) | Reviewed — additive only |
| Infra | `infra/cloudformation/{storage,cognito,ecs}.yml` | Reviewed — correct |
| CI/CD | `.github/workflows/ci.yml` | Reviewed — correct |
| Build | `apps/{api,web}/Dockerfile`, `.dockerignore` | Reviewed — correct |
| Shared | `packages/shared/src/index.ts` | Reviewed — additive |
| QA/docs | `qa/` tests + reports, `docs/production-runbook.md` | Created/updated this phase |

---

## 3. No accidental changes

The complete `git diff` for a critical subset was reviewed line-by-line:

- `services/stripe.ts` — value-gap allocation in `markPaymentPaid`, P0 refund
  guard, anomaly protection. No money-math drift.
- `services/shipping.ts` — `releaseValueGap` runs *inside* the transaction;
  `notifyDisbursementRelease` runs *outside* (correct ordering — the transfer
  is only issued after the release commits).
- `services/sweeper.ts` — bounded batch, exponential backoff, reconciliation.
- `routes/stripe.ts` — webhook switch expanded correctly; `dev-confirm` now
  auth-gated + rate-limited.
- `routes/swaps.ts` — `APP_URL` fully replaced by `WEB_BASE_URL` (grep confirms
  **zero** remaining `APP_URL` references anywhere).
- `schema.prisma` — purely additive (see §4).
- `.env.example` — updated to document `WEB_BASE_URL` production requirement.
- `config.ts` — fail-closed on missing Stripe keys / `localhost` `WEB_BASE_URL`.
- `app.ts` — `trustProxy` in prod, per-route/world rate limits, security headers,
  HSTS + CSP in prod.
- `server.ts` — graceful shutdown (SIGTERM/SIGINT), sweeper start/stop, clean
  DB disconnect.
- `shared/src/index.ts` — additive label maps only.

No accidental changes to balance math, withdrawal debits, auth scoping,
idempotency, or DB constraints were found.

---

## 4. Prisma state verification

- `prisma validate` → **PASS**
- `prisma migrate diff --from-migrations --to-schema-datamodel --exit-code`
  → **exit 0 (no drift)** (also enforced in CI)
- Shadow DB cleaned up after diff.
- 5 new migrations, **all additive** (new tables / new columns / new constraint):

| Migration | Purpose |
|---|---|
| `value_gap_ledger` | ValueGap state machine (PENDING/HELD/RELEASED/REFUNDED) |
| `balance_ledger` | BalanceAccount + BalanceEntry |
| `balance_entry_admin_audit` | Admin adjustment audit fields |
| `balance_entry_amount_check` | `CHECK (amountPence > 0)` |
| `connect_withdrawal_payout_webhook_obs` | Connect, Withdrawal, PayoutMethod, PayoutWebhookObservation |

**No destructive changes** were introduced.

---

## 5. Production env / config checklist

| Item | Status |
|---|---|
| Fail-fast prod validation (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `WEB_BASE_URL` not localhost) | ✅ |
| Belt-and-suspenders: `NODE_ENV=production` + missing Stripe key refuses start | ✅ |
| Simulation never possible in prod (config rejects missing keys) | ✅ |
| CORS allows only `WEB_BASE_URL` (+ localhost:3000 dev-only) | ✅ |
| Secrets not committed (`.env` git-ignored; only `sk_test_` present in local `.env`) | ✅ |
| 5 Secrets Manager secrets documented (DATABASE_URL, STRIPE keys, NEXTAUTH_SECRET, COGNITO_SECRET) | ✅ |
| `trustProxy` enabled in prod (correct behind ALB) | ✅ |
| Security headers (HSTS/CSP prod-only) + rate limits applied | ✅ |

---

## 6. Stripe webhook event-by-event coverage

Handler: `apps/api/src/routes/stripe.ts`. All subscribed events are handled;
anything else is logged as unhandled (safe no-op).

| Event | Handler behaviour | Verified |
|---|---|---|
| `checkout.session.completed` | Marks Payment `PAID`, advances swap AGREED→PAID, allocates value gap | ✅ |
| `account.updated` | Syncs connected-account details/charges_enabled/payouts_enabled | ✅ |
| `payout.paid` | Withdrawal → COMPLETED | ✅ |
| `payout.failed` | Withdrawal → FAILED, reverses debit (`WITHDRAWAL_REVERSAL`) | ✅ |
| `payout.canceled` | Withdrawal → FAILED, reverses debit | ✅ |
| `transfer.failed` | Flags transfer failure / no double-credit | ✅ |
| `transfer.updated` | Reconciles transfer state | ✅ |
| `charge.dispute.created` | Flags payment `refundedAt` (manual handling for response/closed outcomes — see §12) | ✅ |

---

## 7. Money-flow invariant verification (final)

Verified present & correct one final time:

- **Integer GBP pence everywhere** (`Int`).
- Provider model: platform is **merchant of record**; standard charges for
  value-gap + service fee; transfers to connected accounts. **No** Destination
  charge / application-fee model.
- `availableBalancePence` can never go negative — atomic conditional
  `UPDATE ... WHERE availableBalancePence >= amount`.
- `CHECK (amountPence > 0)` on BalanceEntry; `UNIQUE(referenceType,
  referenceId)` prevents duplicate credits.
- All idempotency: Payment `UNIQUE(stripeCheckoutSessionId)`; Transfer
  `value-gap-transfer:{valueGapId}` + `externalPayoutRef` guard; Payout
  `Withdrawal.idempotencyKey`; Refund `refund-{paymentId}` +
  `WHERE refundedAt IS NULL`.
- Crash recovery: `reconcileWithdrawals` + `reconcileValueGaps` idempotent,
  concurrency-safe.
- P0 refund guard: refuses refund if transfer reversal fails or RELEASED gap has
  no transfer ref.
- **10/10 financial invariants** passed in Phase G TEST-mode.

---

## 8. Withdrawal safety verification

- Debit and `Withdrawal` creation are atomic.
- `requestWithdrawal` uses an idempotency key; replay-safe.
- Payout created on connected account with `withdrawal:{...}` key.
- On `FAILED`/`CANCELED` the debit is atomically reversed (`WITHDRAWAL_REVERSAL`
  entry) — no funds lost or double-spent.
- `reconcileWithdrawals` handles out-of-order webhooks via
  `PayoutWebhookObservation` and retries stuck PENDING/PROCESSING with the same
  key.
- Only **current-user** withdrawals can be read/listed/created (no IDOR).
- Rate limited (10/min) + pre-sweep webhook dedupe.

---

## 9. Background jobs / sweeper architecture

- `swap` expiry, `shipping` deadline + in-transit polling, `withdrawal`
  reconciliation, `value-gap` reconciliation — all in-process sweepers on each
  ECS instance.
- All are **idempotent and concurrency-safe** (atomic conditional claims +
  Stripe idempotency keys), so running N× instances is redundant but harmless.
- Sweep interval / bounded-batch / exponential backoff verified.
- Graceful shutdown stops sweepers before DB disconnect (no jobs orphaned).
- **Note (carry-over):** redundant on multi-instance ECS. TODO to move to
  EventBridge + ECS scheduled task. Safe at current scale.

---

## 10. Infrastructure / deployment verification

- `ecs.yml`: ECS/Fargate + ALB, health checks (`/health`, `/`), security groups,
  secrets wired from Secrets Manager. Reviewed — correct.
- `storage.yml` / `cognito.yml`: unchanged this phase, consistent.
- **Runtime containers do NOT run migrations** — must be a separate step (now the
  exact sequence is documented in the runbook, §1).
- Rolling ECS deploy gated by ALB health checks is safe with idempotent/reconciled
  money flow.

---

## 11. Dockerfile verification

- **API `Dockerfile`:** multi-stage, `--ignore-scripts`, `--omit=dev` (dev
  deps & vulns excluded from runtime), `USER node`. Reviewed — correct.
- **Web `Dockerfile`:** Next.js standalone output, build-arg for
  `NEXT_PUBLIC_IMAGE_BASE_URL`. Reviewed — correct.
- **`.dockerignore`:** excludes node_modules, .git, qa artifacts, .env to
  keep images lean and secret-free.

---

## 12. Full test & verification suite (this phase, fresh run)

| Check | Result |
|---|---|
| `prisma validate` | ✅ PASS |
| `prisma migrate diff` (drift) | ✅ exit 0 |
| TypeScript typecheck (4 workspaces) | ✅ PASS |
| ESLint (3 workspaces) | ✅ PASS |
| QA balance suite | ✅ 62/62 |
| QA value-gap suite | ✅ 28/28 |
| QA withdrawal suite | ✅ 15/15 |
| QA connect suite | ✅ 17/17 |
| QA stripe-connect suite | ✅ 19/19 |
| **Total QA** | ✅ **141/141** |
| Dependency audit | ⚠️ 3 high vulns in `deepmerge-ts`, **dev-only** via Prisma CLI — NOT in runtime images |
| Secret scan | ✅ no live keys; stray TEST key git-ignored |

---

## 13. Manual security review (money + auth)

- All money/balance/withdrawal/connect routes are **current-user scoped**
  (`request.user.id`) — no IDOR.
- Cognito JWT verified against remote JWKS; `token_use === 'access'`;
  `client_id` check.
- `charge.dispute.created` requires **manual operations follow-up** for
  `funds_withdrawn`/`closed` outcomes until webhook handlers are extended
  (documented in runbook §6.4). **UK/FCA regulatory review outstanding** — this
  is the single most important external gate before go-live of money movement.

---

## 14. Verdict

**GO — conditional.**

The Swapify codebase is release-ready for the money-flow feature. All code
verification passes; no Critical/High/Medium code defects are outstanding.

**Conditions before full go-live (external / operational, none are code fixes):**

1. **UK/FCA regulatory review** — must sign off before real money movement.
2. **Real Stripe Transfer/Payout observation** — blocked in TEST mode by
   insufficient platform TEST balance (Phase G: 4 automated checks BLOCKED).
   Re-verify in LIVE mode with a controlled smoke test (§1j).
3. **Manual dispute operations doc** — extend webhook handling for
   `dispute.funds_withdrawn` / `dispute.closed` before disputes can occur at
   scale (runbook §6.4).
4. **`.gitignore` fix** — **DONE in Phase J**: `qa/screenshots/`,
   `qa/fixtures.json`, `qa/.fixtures.json` are now ignored (verified via
   `git status --ignored`). No longer an open condition.
5. **Move sweepers to EventBridge/ECS scheduled task** — recommended at scale
   (redundancy only, safe as-is now).
6. **`deepmerge-ts` dev-only advisories** — Prisma CLI chain; not in runtime,
   track upstream.

---

## 15. Manual actions / next steps

1. **Create the release commit** (Phase J): stage only the reviewed
   production/db/infra/ci/docs files; screenshots and fixtures are now ignored
   so `git add -A` is safe.
2. Complete the runbook exact sequence **a–l** (documented in
   `docs/production-runbook.md` §1).
4. Obtain **UK/FCA sign-off** before enabling live money movement.
5. After live deploy, run the controlled live smoke test and re-verify blocked
   G-phase checks with real balances.
6. Do **not** commit/push outside this documented release process until the
   FYI conditions above are satisfied.
