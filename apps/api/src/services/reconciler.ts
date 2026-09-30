import { prisma } from '@swapify/db';
import pino from 'pino';
import { validateReconcilerConfig } from '../config.js';
import { assertRealDisbursementProvider, wireStripeConnect } from './stripe-connect.js';
import { expireExpiredSwaps } from './sweeper.js';
import type { AppRole } from '../config.js';

const log = pino({ name: 'reconciler', level: process.env.LOG_LEVEL ?? 'info' });

// ---------------------------------------------------------------------------
// One-shot reconciliation
//
// The scheduled worker runs exactly one cycle per invocation and exits. It calls
// expireExpiredSwaps() — the SAME single-cycle function the in-process sweeper
// loop calls — so there is one copy of every reconciliation rule:
//
//   expireExpiredSwaps()
//     1. swap expiry (atomic claim -> refund -> item reactivation -> shipments)
//     2. reconcileRefunds()                   refundedAt guard + Stripe idem key
//     3. reconcileValueGaps()                 HELD -> REFUNDED/RELEASED + credit
//     4. reconcileWithdrawals()               stale payouts, out-of-order payouts
//
// This is the production baseline cycle (image b084e2b) unchanged: this
// release adds scheduling and ownership only, and introduces no new
// reconciliation step.
//
// Nothing is duplicated here on purpose: the worker owns scheduling, not
// business logic. Per-item isolation is unchanged — expireExpiredSwaps() already
// catches per-item errors and continues, and only a failure of the cycle
// itself (DB unreachable, misconfiguration) propagates to the caller.
// ---------------------------------------------------------------------------

export type ReconciliationCycle = () => Promise<number>;

export interface ReconciliationResult {
  role: AppRole;
  expiredSwaps: number;
  durationMs: number;
}

// Fail-closed order matters:
//   1. config       - no DATABASE_URL/STRIPE_SECRET_KEY -> refuse to start.
//   2. wire         - activate the real Stripe Connect disbursement provider.
//   3. assert       - prove it is the real one, not the placeholder.
//   4. run          - only now touch financial state.
export async function runReconciliationOnce(
  runCycle: ReconciliationCycle = expireExpiredSwaps,
): Promise<ReconciliationResult> {
  validateReconcilerConfig();
  wireStripeConnect();
  assertRealDisbursementProvider();

  const role = (process.env.APP_ROLE?.trim().toLowerCase() || 'api') as AppRole;
  const startedAt = Date.now();
  const expiredSwaps = await runCycle();
  const durationMs = Date.now() - startedAt;

  log.info({ expiredSwaps, durationMs }, 'Reconciliation cycle complete');
  return { role, expiredSwaps, durationMs };
}

// Prisma keeps its connection pool alive after the cycle; a short-lived task
// must close it so the container actually exits instead of being held open by
// an idle socket.
export async function disconnectReconciler(): Promise<void> {
  await prisma.$disconnect();
}
