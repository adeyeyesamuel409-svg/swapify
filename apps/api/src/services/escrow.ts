import {
  EscrowHold,
  EscrowStatus,
  GapPayer,
  ItemStatus,
  Swap,
  SwapStatus,
  TransactionDirection,
  TransactionType,
  prisma,
} from '@swapify/db';
import { applyLedgerEntry } from './ledger.js';

// The party whose items are worth less - the one who should RECEIVE the gap
// tokens once the swap completes. The gap payer is the opposite party.
export function gapPayeeUserId(swap: Pick<Swap, 'gapPayer' | 'offeringUserId' | 'requestedUserId'>): string {
  return swap.gapPayer === GapPayer.OFFERING_USER ? swap.requestedUserId : swap.offeringUserId;
}

export function gapPayerUserId(swap: Pick<Swap, 'gapPayer' | 'offeringUserId' | 'requestedUserId'>): string {
  return swap.gapPayer === GapPayer.OFFERING_USER ? swap.offeringUserId : swap.requestedUserId;
}

async function walletIdFor(userId: string): Promise<string> {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  return wallet.id;
}

// Moves the gap tokens out of the payer's balance into the hold. Idempotent:
// a hold is only ever created once, and the ledger entry can't be re-applied.
export async function fundEscrow(swap: Swap): Promise<EscrowHold> {
  if (swap.gapMicroTokens <= 0n) {
    throw new Error('There is no value gap to hold in escrow');
  }

  const existing = await prisma.escrowHold.findUnique({ where: { swapId: swap.id } });
  if (existing) return existing;

  const payerWalletId = await walletIdFor(gapPayerUserId(swap));

  await applyLedgerEntry({
    walletId: payerWalletId,
    type: TransactionType.ESCROW_HOLD,
    direction: TransactionDirection.DEBIT,
    amountMicroTokens: swap.gapMicroTokens,
    referenceId: swap.id,
    note: `Escrow hold for swap ${swap.id}`,
    idempotencyKey: `escrow:hold:${swap.id}`,
  });

  return prisma.escrowHold.upsert({
    where: { swapId: swap.id },
    create: {
      swapId: swap.id,
      walletId: payerWalletId,
      amountMicroTokens: swap.gapMicroTokens,
      status: EscrowStatus.HELD,
    },
    update: {},
  });
}

// Swap completed: the gap tokens go to the party who gave more value.
export async function releaseEscrow(swap: Swap): Promise<void> {
  const hold = await prisma.escrowHold.findUnique({ where: { swapId: swap.id } });
  if (!hold || hold.status !== EscrowStatus.HELD) return;

  const payeeWalletId = await walletIdFor(gapPayeeUserId(swap));

  await applyLedgerEntry({
    walletId: payeeWalletId,
    type: TransactionType.ESCROW_RELEASE,
    direction: TransactionDirection.CREDIT,
    amountMicroTokens: hold.amountMicroTokens,
    referenceId: swap.id,
    note: `Escrow released after swap ${swap.id} completed`,
    idempotencyKey: `escrow:release:${swap.id}`,
  });

  await prisma.escrowHold.update({
    where: { id: hold.id },
    data: { status: EscrowStatus.RELEASED, releasedAt: new Date() },
  });
}

// Swap cancelled or expired: the gap tokens go back to the payer.
export async function refundEscrow(swap: Swap): Promise<void> {
  const existing = await prisma.escrowHold.findUnique({ where: { swapId: swap.id } });
  if (!existing || existing.status !== EscrowStatus.HELD) return;

  await applyLedgerEntry({
    walletId: existing.walletId,
    type: TransactionType.ESCROW_REFUND,
    direction: TransactionDirection.CREDIT,
    amountMicroTokens: existing.amountMicroTokens,
    referenceId: swap.id,
    note: `Escrow refunded for swap ${swap.id}`,
    idempotencyKey: `escrow:refund:${swap.id}`,
  });

  await prisma.escrowHold.update({
    where: { id: existing.id },
    data: { status: EscrowStatus.REFUNDED, refundedAt: new Date() },
  });
}

// Agreements/escrow that outlived their deadline with no confirmation from
// either party get cancelled and refunded. Runs on an interval for now;
// becomes a scheduled Lambda in Sprint 8.
export async function expireExpiredSwaps(): Promise<number> {
  const now = new Date();

  const expired = await prisma.swap.findMany({
    where: {
      status: { in: [SwapStatus.AGREED, SwapStatus.ESCROWED] },
      expiresAt: { lt: now },
      offeringUserConfirmedAt: null,
      requestedUserConfirmedAt: null,
    },
  });

  for (const swap of expired) {
    try {
      if (swap.status === SwapStatus.ESCROWED) {
        await refundEscrow(swap);
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

export function startEscrowSweeper(intervalMs = 5 * 60 * 1000): NodeJS.Timeout {
  void expireExpiredSwaps();
  return setInterval(() => {
    void expireExpiredSwaps();
  }, intervalMs);
}
