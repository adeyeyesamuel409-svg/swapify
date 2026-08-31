// ---------------------------------------------------------------------------
// Internal user balance / settlement service
//
// IMPORTANT: This is internal accounting only. External withdrawals and
// payment-provider disbursements are intentionally disabled pending business,
// legal and FCA review.
//
// The balance ledger records the user's available balance after value-gap
// settlement. Every balance movement is tracked in BalanceEntry for audit.
// ---------------------------------------------------------------------------

import {
  BalanceEntryType,
  BalanceEntryDirection,
  Prisma,
  prisma,
} from '@swapify/db';
import pino from 'pino';

const log = pino({ name: 'balance', level: process.env.LOG_LEVEL ?? 'info' });

// ---------------------------------------------------------------------------
// getOrCreateBalanceAccount — ensure account exists (idempotent)
// ---------------------------------------------------------------------------

export async function getOrCreateBalanceAccount(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  const existing = await tx.balanceAccount.findUnique({ where: { userId } });
  if (existing) return existing;

  log.info({ userId }, 'Creating balance account');
  return tx.balanceAccount.create({
    data: { userId, currency: 'GBP', availableBalancePence: 0, pendingBalancePence: 0 },
  });
}

// ---------------------------------------------------------------------------
// creditValueGap — credit recipient after value gap release
//
// Must be called INSIDE the same transaction as releaseValueGap.
// Creates exactly one BalanceEntry and increments availableBalancePence.
//
// Idempotent: the UNIQUE(referenceType, referenceId) constraint on
// BalanceEntry prevents duplicate credits for the same value gap.
//
// Returns the created BalanceEntry, or null if already credited.
// ---------------------------------------------------------------------------

export async function creditValueGap(
  tx: Prisma.TransactionClient,
  params: {
    valueGapId: string;
    recipientUserId: string;
    valueGapPence: number;
    currency: string;
    swapId: string;
  },
): Promise<{ id: string } | null> {
  // Check for existing credit — idempotent no-op
  const existing = await tx.balanceEntry.findUnique({
    where: { referenceType_referenceId: { referenceType: 'VALUE_GAP', referenceId: params.valueGapId } },
    select: { id: true },
  });

  if (existing) {
    log.info(
      { valueGapId: params.valueGapId, balanceEntryId: existing.id },
      'Balance credit already exists for this value gap',
    );
    return null;
  }

  // Ensure account exists
  const account = await getOrCreateBalanceAccount(tx, params.recipientUserId);

  // Create balance entry and increment account atomically
  const entry = await tx.balanceEntry.create({
    data: {
      balanceAccountId: account.id,
      userId: params.recipientUserId,
      type: BalanceEntryType.VALUE_GAP_CREDIT,
      amountPence: params.valueGapPence,
      currency: params.currency,
      direction: BalanceEntryDirection.CREDIT,
      referenceType: 'VALUE_GAP',
      referenceId: params.valueGapId,
      valueGapId: params.valueGapId,
      description: `Value-gap settlement for swap ${params.swapId}`,
    },
  });

  await tx.balanceAccount.update({
    where: { id: account.id },
    data: { availableBalancePence: { increment: params.valueGapPence } },
  });

  log.info(
    {
      balanceEntryId: entry.id,
      userId: params.recipientUserId,
      valueGapId: params.valueGapId,
      amountPence: params.valueGapPence,
    },
    'Balance credit created',
  );

  return { id: entry.id };
}

// ---------------------------------------------------------------------------
// getUserBalance — read-only accessor for current user's balance
// ---------------------------------------------------------------------------

export async function getUserBalance(userId: string) {
  const account = await prisma.balanceAccount.findUnique({ where: { userId } });
  if (!account) {
    return { availableBalancePence: 0, pendingBalancePence: 0, currency: 'GBP' };
  }
  return {
    availableBalancePence: account.availableBalancePence,
    pendingBalancePence: account.pendingBalancePence,
    currency: account.currency,
  };
}

// ---------------------------------------------------------------------------
// getUserBalanceEntries — paginated transaction history for current user
// ---------------------------------------------------------------------------

export async function getUserBalanceEntries(
  userId: string,
  params: { cursor?: string; limit?: number } = {},
) {
  const limit = Math.min(params.limit ?? 20, 100);

  const entries = await prisma.balanceEntry.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      type: true,
      amountPence: true,
      currency: true,
      direction: true,
      referenceType: true,
      referenceId: true,
      description: true,
      createdAt: true,
    },
  });

  const hasMore = entries.length > limit;
  if (hasMore) entries.pop();

  return {
    entries,
    nextCursor: hasMore ? entries[entries.length - 1]?.id ?? null : null,
  };
}

// ---------------------------------------------------------------------------
// reconcileUserBalance — verify ledger vs account balance consistency
//
// Returns the discrepancy (0 = consistent). Logs critical errors on mismatch.
// Does NOT silently repair — that requires a human business decision.
// ---------------------------------------------------------------------------

export async function reconcileUserBalance(userId: string): Promise<{
  expectedAvailable: number;
  actualAvailable: number;
  discrepancy: number;
}> {
  const account = await prisma.balanceAccount.findUnique({ where: { userId } });
  if (!account) {
    return { expectedAvailable: 0, actualAvailable: 0, discrepancy: 0 };
  }

  // Calculate expected: sum of CREDIT entries minus sum of DEBIT entries
  const credits = await prisma.balanceEntry.aggregate({
    where: { userId, direction: 'CREDIT' },
    _sum: { amountPence: true },
  });
  const debits = await prisma.balanceEntry.aggregate({
    where: { userId, direction: 'DEBIT' },
    _sum: { amountPence: true },
  });

  const expectedAvailable = Number(credits._sum.amountPence ?? 0n) - Number(debits._sum.amountPence ?? 0n);
  const actualAvailable = account.availableBalancePence;
  const discrepancy = expectedAvailable - actualAvailable;

  if (discrepancy !== 0) {
    log.error(
      {
        userId,
        expectedAvailable,
        actualAvailable,
        discrepancy,
      },
      'BALANCE_RECONCILIATION_MISMATCH',
    );
  }

  return { expectedAvailable, actualAvailable, discrepancy };
}

// ---------------------------------------------------------------------------
// getBalanceStats — admin-only aggregate view
// ---------------------------------------------------------------------------

export async function getBalanceStats() {
  const [totalAvailable, totalPending, fundedCount, creditCount, creditTotal, debitCount, debitTotal] =
    await Promise.all([
      prisma.balanceAccount.aggregate({ _sum: { availableBalancePence: true } }),
      prisma.balanceAccount.aggregate({ _sum: { pendingBalancePence: true } }),
      prisma.balanceAccount.count({ where: { availableBalancePence: { gt: 0 } } }),
      prisma.balanceEntry.aggregate({
        where: { type: 'VALUE_GAP_CREDIT' },
        _sum: { amountPence: true },
        _count: { id: true },
      }),
      prisma.balanceEntry.aggregate({
        where: { direction: 'CREDIT' },
        _sum: { amountPence: true },
      }),
      prisma.balanceEntry.aggregate({
        where: { direction: 'DEBIT' },
        _sum: { amountPence: true },
        _count: { id: true },
      }),
      prisma.balanceEntry.aggregate({
        where: { type: 'WITHDRAWAL_DEBIT' },
        _sum: { amountPence: true },
        _count: { id: true },
      }),
    ]);

  return {
    totalAvailableBalancePence: Number(totalAvailable._sum.availableBalancePence ?? 0n),
    totalPendingBalancePence: Number(totalPending._sum.pendingBalancePence ?? 0n),
    fundedUserCount: fundedCount,
    valueGapCredits: {
      count: creditCount._count.id,
      totalPence: Number(creditTotal._sum.amountPence ?? 0n),
    },
    totalCredits: Number(creditTotal._sum.amountPence ?? 0n),
    totalDebits: Number(debitTotal._sum.amountPence ?? 0n),
    // Withdrawals are not implemented — these will always be 0
    withdrawals: {
      count: debitCount._count.id,
      totalPence: Number(debitTotal._sum.amountPence ?? 0n),
    },
  };
}

// ---------------------------------------------------------------------------
// getUserBalanceAdmin — admin lookup for a specific user's balance
// ---------------------------------------------------------------------------

export async function getUserBalanceAdmin(userId: string) {
  const account = await prisma.balanceAccount.findUnique({
    where: { userId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      entries: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          type: true,
          amountPence: true,
          direction: true,
          referenceType: true,
          referenceId: true,
          description: true,
          createdAt: true,
        },
      },
    },
  });

  if (!account) {
    return {
      account: null,
      reconciliation: { expectedAvailable: 0, actualAvailable: 0, discrepancy: 0 },
    };
  }

  const reconciliation = await reconcileUserBalance(userId);

  return {
    account: {
      id: account.id,
      userId: account.userId,
      user: account.user,
      currency: account.currency,
      availableBalancePence: account.availableBalancePence,
      pendingBalancePence: account.pendingBalancePence,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    },
    entries: account.entries,
    reconciliation,
  };
}
