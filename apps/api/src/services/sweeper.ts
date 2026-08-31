import { ItemStatus, PaymentStatus, SwapStatus, prisma } from '@swapify/db';
import { refundSwapPayment } from './stripe.js';
import { cancelSwapShipments } from './shipping.js';
import { reconcileValueGaps } from './value-gap.js';
import { reconcileWithdrawals } from './withdrawal.js';
import pino from 'pino';

const log = pino({ name: 'swap-sweeper', level: process.env.LOG_LEVEL ?? 'info' });

// Agreements/payments that outlived their deadline with no confirmation from
// either party get cancelled and the paid gap payment (if any) refunded.
// Runs on an interval for now; becomes a scheduled Lambda in a later sprint.
//
// Concurrency safety: ECS may run several API instances, so this sweep must
// never process the same swap twice. The swap -> EXPIRED transition is an
// atomic conditional UPDATE (updateMany with the full eligibility predicate in
// the WHERE clause); only the instance whose update reports `count === 1` may
// run the side effects (refund + item reactivation). A second instance either
// observes the swap already EXPIRED (no match) or a participant confirmed
// receipt in the meantime (no match) and skips it.
//
// TODO: Migrate to EventBridge + ECS scheduled task for production. The current
// in-process setInterval is safe for idempotent operations but will execute the
// sweep N times for N instances. Each sweep is bounded and idempotent, so this
// is safe but wasteful. EventBridge + single task avoids redundant work.
//
// Backoff: If consecutive errors occur, exponentially increase the interval
// (up to a cap) to avoid hot retry loops on persistent failures.

const MAX_SWEEP_BATCH = 20;

const BASE_INTERVAL_MS = 5 * 60 * 1000;      // 5 minutes
const MAX_INTERVAL_MS = 60 * 60 * 1000;       // 1 hour cap

export async function expireExpiredSwaps(): Promise<number> {
  const now = new Date();

  const expired = await prisma.swap.findMany({
    where: {
      status: { in: [SwapStatus.AGREED, SwapStatus.PAID] },
      expiresAt: { lt: now },
      offeringUserConfirmedAt: null,
      requestedUserConfirmedAt: null,
    },
    include: { payment: true },
    take: MAX_SWEEP_BATCH,
  });

  let expiredCount = 0;
  for (const swap of expired) {
    try {
      // Atomic claim: only one API instance can win this conditional UPDATE.
      // If another instance already transitioned this swap, or a participant
      // confirmed receipt after our read, the WHERE clause matches nothing and
      // we do nothing (no refund, no item release).
      const claimed = await prisma.swap.updateMany({
        where: {
          id: swap.id,
          status: { in: [SwapStatus.AGREED, SwapStatus.PAID] },
          expiresAt: { lt: now },
          offeringUserConfirmedAt: null,
          requestedUserConfirmedAt: null,
        },
        data: { status: SwapStatus.EXPIRED, cancelledAt: now },
      });
      if (claimed.count === 0) {
        continue;
      }

      if (swap.payment) {
        await refundSwapPayment(swap.payment.id);
      }
      await prisma.item.updateMany({
        where: { id: { in: [swap.offeringItemId, swap.requestedItemId] } },
        data: { status: ItemStatus.ACTIVE },
      });
      // Cancel any active shipments (best-effort; may not exist)
      try {
        await cancelSwapShipments(prisma, swap.id, now);
      } catch (err) {
        // Non-fatal: log but continue — the swap is already EXPIRED.
        log.warn({ err, swapId: swap.id }, 'Failed to cancel shipments during swap expiry');
      }
      expiredCount += 1;
    } catch (err) {
      // Leave it for the next sweep if something transient went wrong.
      log.error({ err, swapId: swap.id }, 'Failed to expire swap');
    }
  }

  // Reconcile refunds: any recorded gap payment whose swap is already terminal
  // (CANCELLED/EXPIRED) must eventually be refunded. This recovers the small
  // window where an instance claimed a swap and then crashed before issuing
  // the refund. Safe to run from many instances concurrently because
  // refundSwapPayment is idempotent (refundedAt guard + Stripe idempotency key).
  await reconcileRefunds();

  // Reconcile value gaps: any HELD value gap for a cancelled/expired swap
  // must be transitioned to REFUNDED. This recovers cases where the value gap
  // allocation succeeded but the refund path failed.
  try {
    const reconciled = await reconcileValueGaps();
    if (reconciled > 0) {
      log.info({ reconciled }, 'Reconciled stuck value gaps');
    }
  } catch (err) {
    log.error({ err }, 'Failed to reconcile value gaps');
  }

  // P1 #5+#6: Reconcile stale withdrawals and out-of-order payout webhooks.
  // Handles crash recovery (payout created but stripePayoutId not persisted)
  // and out-of-order webhook delivery (webhook arrived before withdrawal).
  try {
    const withdrawn = await reconcileWithdrawals();
    if (withdrawn > 0) {
      log.info({ reconciled: withdrawn }, 'Reconciled stale withdrawals');
    }
  } catch (err) {
    log.error({ err }, 'Failed to reconcile withdrawals');
  }

  return expiredCount;
}

// TODO: Migrate to EventBridge + ECS scheduled task for production. The current
// in-process setInterval is safe for idempotent operations but will execute the
// sweep N times for N instances. Each sweep is bounded and idempotent, so this
// is safe but wasteful. EventBridge + single task avoids redundant work.

async function reconcileRefunds(): Promise<void> {
  const pending = await prisma.payment.findMany({
    where: {
      status: PaymentStatus.PAID,
      refundedAt: null,
      swap: { status: { in: [SwapStatus.CANCELLED, SwapStatus.EXPIRED] } },
    },
    select: { id: true },
    take: MAX_SWEEP_BATCH,
  });

  for (const payment of pending) {
    try {
      await refundSwapPayment(payment.id);
    } catch (err) {
      log.error({ err, paymentId: payment.id }, 'Failed to reconcile refund');
    }
  }
}

// ---------------------------------------------------------------------------
// Exponential backoff sweeper loop
// ---------------------------------------------------------------------------

let consecutiveErrors = 0;
let currentIntervalMs = BASE_INTERVAL_MS;
let sweepTimer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;

function scheduleNext(): void {
  if (stopped) return;
  sweepTimer = setTimeout(() => {
    void sweepCycle();
  }, currentIntervalMs);
}

async function sweepCycle(): Promise<void> {
  try {
    await expireExpiredSwaps();
    consecutiveErrors = 0;
    currentIntervalMs = BASE_INTERVAL_MS;
  } catch (err) {
    consecutiveErrors++;
    log.error({ err, consecutiveErrors }, 'Sweep cycle failed');
    currentIntervalMs = Math.min(
      BASE_INTERVAL_MS * Math.pow(2, consecutiveErrors),
      MAX_INTERVAL_MS,
    );
  }
  scheduleNext();
}

export function startSwapSweeper(): ReturnType<typeof setTimeout> {
  stopped = false;
  void sweepCycle();
  return sweepTimer!;
}

export function stopSwapSweeper(handle: ReturnType<typeof setTimeout>): void {
  stopped = true;
  clearTimeout(handle);
  sweepTimer = null;
}
