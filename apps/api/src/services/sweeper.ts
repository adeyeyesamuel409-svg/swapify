import { ItemStatus, SwapStatus, prisma } from '@swapify/db';
import { refundSwapPayment } from './stripe.js';

// Agreements/payments that outlived their deadline with no confirmation from
// either party get cancelled and the paid gap payment (if any) refunded.
// Runs on an interval for now; becomes a scheduled Lambda in a later sprint.
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

  for (const swap of expired) {
    try {
      if (swap.payment) {
        await refundSwapPayment(swap.payment.id);
      }
      await prisma.swap.update({
        where: { id: swap.id },
        data: { status: SwapStatus.EXPIRED, cancelledAt: now },
      });
      await prisma.item.updateMany({
        where: { id: { in: [swap.offeringItemId, swap.requestedItemId] } },
        data: { status: ItemStatus.ACTIVE },
      });
    } catch (err) {
      // Leave it for the next sweep if something transient went wrong.
      console.error(`Failed to expire swap ${swap.id}`, err);
    }
  }

  return expired.length;
}

export function startSwapSweeper(intervalMs = 5 * 60 * 1000): NodeJS.Timeout {
  void expireExpiredSwaps();
  return setInterval(() => {
    void expireExpiredSwaps();
  }, intervalMs);
}
