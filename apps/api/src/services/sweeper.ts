import { ItemStatus, PaymentStatus, SwapStatus, prisma } from '@swapify/db';
import { refundSwapPayment } from './stripe.js';
import { cancelSwapShipments } from './shipping.js';

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
      } catch {
        // Non-fatal
      }
      expiredCount += 1;
    } catch (err) {
      // Leave it for the next sweep if something transient went wrong.
      console.error(`Failed to expire swap ${swap.id}`, err);
    }
  }

  // Reconcile refunds: any recorded gap payment whose swap is already terminal
  // (CANCELLED/EXPIRED) must eventually be refunded. This recovers the small
  // window where an instance claimed a swap and then crashed before issuing
  // the refund. Safe to run from many instances concurrently because
  // refundSwapPayment is idempotent (refundedAt guard + Stripe idempotency key).
  await reconcileRefunds();

  return expiredCount;
}

async function reconcileRefunds(): Promise<void> {
  const pending = await prisma.payment.findMany({
    where: {
      status: PaymentStatus.PAID,
      refundedAt: null,
      swap: { status: { in: [SwapStatus.CANCELLED, SwapStatus.EXPIRED] } },
    },
    select: { id: true },
  });

  for (const payment of pending) {
    try {
      await refundSwapPayment(payment.id);
    } catch (err) {
      console.error(`Failed to reconcile refund for payment ${payment.id}`, err);
    }
  }
}

export function startSwapSweeper(intervalMs = 5 * 60 * 1000): NodeJS.Timeout {
  void expireExpiredSwaps();
  return setInterval(() => {
    void expireExpiredSwaps();
  }, intervalMs);
}
