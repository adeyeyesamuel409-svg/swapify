// ---------------------------------------------------------------------------
// Withdrawal service
//
// Manages the full withdrawal lifecycle: validation, balance deduction,
// Stripe payout creation, status tracking, and failure reversal.
//
// Flow:
//   1. User requests withdrawal -> validate balance + connected account
//   2. Create Withdrawal record (PENDING), debit availableBalance
//   3. Create Stripe payout on connected account
//   4. Webhook updates status (PROCESSING -> COMPLETED / FAILED)
//   5. On failure: reverse debit back to availableBalance
//
// Idempotency:
//   - Withdrawal.idempotencyKey is used as Stripe payout idempotency key
//   - Duplicate requests rejected at validation layer
//
// Regulatory note: This service processes fund disbursements via Stripe
// Connect. Regulatory classification requires UK fintech/payment-services
// legal review.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { prisma } from '@swapify/db';
import { createPayout } from './stripe-connect.js';
import pino from 'pino';

const log = pino({ name: 'withdrawal', level: process.env.LOG_LEVEL ?? 'info' });

// ---------------------------------------------------------------------------
// Withdrawal error codes — stable codes for frontend error mapping
// ---------------------------------------------------------------------------

export type WithdrawalErrorCode =
  | 'INSUFFICIENT_BALANCE'
  | 'WITHDRAWAL_LIMIT_EXCEEDED'
  | 'PAYOUTS_DISABLED'
  | 'CONNECT_ACCOUNT_REQUIRED'
  | 'ACCOUNT_NOT_ACTIVE'
  | 'PAYOUT_METHOD_REQUIRED'
  | 'WITHDRAWAL_NOT_FOUND'
  | 'WITHDRAWAL_ALREADY_PROCESSING'
  | 'USER_NOT_FOUND'
  | 'MINIMUM_WITHDRAWAL'
  | 'MAXIMUM_WITHDRAWAL'
  | 'WITHDRAWAL_FAILED';

export class WithdrawalError extends Error {
  code: WithdrawalErrorCode;
  constructor(code: WithdrawalErrorCode, message: string) {
    super(message);
    this.name = 'WithdrawalError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Config constants
// ---------------------------------------------------------------------------

const MIN_WITHDRAWAL_PENCE = 500;       // 5.00 GBP
const MAX_WITHDRAWAL_PENCE = 500_000;   // 5,000.00 GBP
const DAILY_LIMIT_PENCE = 100_000;      // 1,000.00 GBP
const WEEKLY_LIMIT_PENCE = 250_000;     // 2,500.00 GBP
const MONTHLY_LIMIT_PENCE = 1_000_000;  // 10,000.00 GBP

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WithdrawalResult {
  id: string;
  status: string;
  amountPence: number;
  createdAt: string;
}

export interface WithdrawalStatus {
  id: string;
  status: string;
  amountPence: number;
  currency: string;
  stripePayoutId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
}

// ---------------------------------------------------------------------------
// requestWithdrawal
// ---------------------------------------------------------------------------

export async function requestWithdrawal(params: {
  userId: string;
  amountPence: number;
}): Promise<WithdrawalResult> {
  const { userId, amountPence } = params;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new WithdrawalError('USER_NOT_FOUND', 'User not found');
  if (user.payoutsDisabled) {
    throw new WithdrawalError('PAYOUTS_DISABLED', 'Payouts are disabled for this account');
  }

  if (amountPence < MIN_WITHDRAWAL_PENCE) {
    throw new WithdrawalError('MINIMUM_WITHDRAWAL', `Minimum withdrawal is ${(MIN_WITHDRAWAL_PENCE / 100).toFixed(2)} GBP`);
  }
  if (amountPence > MAX_WITHDRAWAL_PENCE) {
    throw new WithdrawalError('MAXIMUM_WITHDRAWAL', `Maximum withdrawal is ${(MAX_WITHDRAWAL_PENCE / 100).toFixed(2)} GBP`);
  }

  const connectedAccount = await prisma.connectedAccount.findUnique({ where: { userId } });
  if (!connectedAccount) {
    throw new WithdrawalError('CONNECT_ACCOUNT_REQUIRED', 'No payout account set up. Please complete onboarding first.');
  }
  if (connectedAccount.status !== 'ACTIVE') {
    throw new WithdrawalError('ACCOUNT_NOT_ACTIVE', `Payout account is ${connectedAccount.status.toLowerCase()}. Please complete verification.`);
  }

  const payoutMethod = await prisma.payoutMethod.findFirst({
    where: { userId, isDefault: true, isActive: true },
  });
  if (!payoutMethod) {
    throw new WithdrawalError('PAYOUT_METHOD_REQUIRED', 'No active payout method. Please add a bank account.');
  }

  const balanceAccount = await prisma.balanceAccount.findUnique({ where: { userId } });
  if (!balanceAccount || balanceAccount.availableBalancePence < amountPence) {
    throw new WithdrawalError('INSUFFICIENT_BALANCE', 'Insufficient balance');
  }

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [dailyTotal, weeklyTotal, monthlyTotal] = await Promise.all([
    prisma.withdrawal.aggregate({
      where: { userId, createdAt: { gte: dayAgo }, status: { notIn: ['CANCELLED'] } },
      _sum: { amountPence: true },
    }),
    prisma.withdrawal.aggregate({
      where: { userId, createdAt: { gte: weekAgo }, status: { notIn: ['CANCELLED'] } },
      _sum: { amountPence: true },
    }),
    prisma.withdrawal.aggregate({
      where: { userId, createdAt: { gte: monthAgo }, status: { notIn: ['CANCELLED'] } },
      _sum: { amountPence: true },
    }),
  ]);

  const dailyUsed = Number(dailyTotal._sum.amountPence ?? 0n);
  const weeklyUsed = Number(weeklyTotal._sum.amountPence ?? 0n);
  const monthlyUsed = Number(monthlyTotal._sum.amountPence ?? 0n);

  if (dailyUsed + amountPence > DAILY_LIMIT_PENCE) {
    throw new WithdrawalError('WITHDRAWAL_LIMIT_EXCEEDED', 'Daily withdrawal limit exceeded');
  }
  if (weeklyUsed + amountPence > WEEKLY_LIMIT_PENCE) {
    throw new WithdrawalError('WITHDRAWAL_LIMIT_EXCEEDED', 'Weekly withdrawal limit exceeded');
  }
  if (monthlyUsed + amountPence > MONTHLY_LIMIT_PENCE) {
    throw new WithdrawalError('WITHDRAWAL_LIMIT_EXCEEDED', 'Monthly withdrawal limit exceeded');
  }

  // Deterministic idempotency key derived from user, amount, and a fine-grained
  // time bucket (5 minutes). This prevents duplicate payouts if the request is
  // retried within the same window. The same key is stored on the Withdrawal
  // record and used as the Stripe payout idempotency key.
  const idempotencyKey = `withdrawal:${createHash('sha256').update(`${userId}:${amountPence}:${Math.floor(Date.now() / 300_000)}`).digest('hex').slice(0, 32)}`;

  const result = await prisma.$transaction(async (tx) => {
    // Atomic conditional UPDATE: only succeeds if sufficient balance exists.
    // This prevents two concurrent withdrawals from both passing the balance
    // check and producing a negative balance. The UPDATE is a no-op (count=0)
    // if another request already consumed the available balance.
    const reserved = await tx.balanceAccount.updateMany({
      where: { userId, availableBalancePence: { gte: amountPence } },
      data: {
        availableBalancePence: { decrement: amountPence },
        pendingBalancePence: { increment: amountPence },
      },
    });

    if (reserved.count === 0) {
      throw new WithdrawalError('INSUFFICIENT_BALANCE', 'Insufficient balance');
    }

    // Fetch the balance account to get the id for the ledger entry.
    const balance = await tx.balanceAccount.findUniqueOrThrow({ where: { userId } });

    const withdrawal = await tx.withdrawal.create({
      data: {
        userId,
        payoutMethodId: payoutMethod.id,
        amountPence,
        status: 'PENDING',
        idempotencyKey,
      },
    });

    await tx.balanceEntry.create({
      data: {
        balanceAccountId: balance.id,
        userId,
        type: 'WITHDRAWAL_DEBIT',
        amountPence,
        currency: 'GBP',
        direction: 'DEBIT',
        referenceType: 'WITHDRAWAL_DEBIT',
        referenceId: withdrawal.id,
        description: `Withdrawal requested: ${(amountPence / 100).toFixed(2)} GBP`,
      },
    });

    return withdrawal;
  });

  log.info(
    { userId, withdrawalId: result.id, amountPence, idempotencyKey },
    'Withdrawal created, attempting Stripe payout',
  );

  try {
    const payout = await createPayout({
      connectedAccountId: connectedAccount.stripeAccountId,
      amountPence,
      idempotencyKey,
    });

    await prisma.withdrawal.update({
      where: { id: result.id },
      data: {
        status: 'PROCESSING',
        stripePayoutId: payout.payoutId,
        processedAt: new Date(),
      },
    });

    log.info(
      { userId, withdrawalId: result.id, payoutId: payout.payoutId },
      'Stripe payout created',
    );

    return {
      id: result.id,
      status: 'PROCESSING',
      amountPence,
      createdAt: result.createdAt.toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, userId, withdrawalId: result.id }, 'Stripe payout creation failed');

    await prisma.$transaction(async (tx) => {
      await tx.withdrawal.update({
        where: { id: result.id },
        data: { status: 'FAILED', failedAt: new Date(), reversalReason: message },
      });

      await tx.balanceAccount.update({
        where: { userId },
        data: {
          availableBalancePence: { increment: amountPence },
          pendingBalancePence: { decrement: amountPence },
        },
      });

      await tx.balanceEntry.create({
        data: {
          balanceAccountId: balanceAccount!.id,
          userId,
          type: 'WITHDRAWAL_REVERSAL',
          amountPence,
          currency: 'GBP',
          direction: 'CREDIT',
          referenceType: 'WITHDRAWAL_REVERSAL',
          referenceId: result.id,
          description: `Withdrawal failed: ${message}`,
        },
      });
    });

    throw new Error(`Withdrawal failed: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// getWithdrawalStatus
// ---------------------------------------------------------------------------

export async function getWithdrawalStatus(
  userId: string,
  withdrawalId: string,
): Promise<WithdrawalStatus> {
  const withdrawal = await prisma.withdrawal.findFirst({
    where: { id: withdrawalId, userId },
  });

  if (!withdrawal) {
    throw new WithdrawalError('WITHDRAWAL_NOT_FOUND', 'Withdrawal not found');
  }

  return {
    id: withdrawal.id,
    status: withdrawal.status,
    amountPence: withdrawal.amountPence,
    currency: withdrawal.currency,
    stripePayoutId: withdrawal.stripePayoutId,
    createdAt: withdrawal.createdAt.toISOString(),
    updatedAt: withdrawal.updatedAt.toISOString(),
    completedAt: withdrawal.completedAt?.toISOString() ?? null,
    failedAt: withdrawal.failedAt?.toISOString() ?? null,
    failureReason: withdrawal.reversalReason,
  };
}

// ---------------------------------------------------------------------------
// cancelWithdrawal
// ---------------------------------------------------------------------------

export async function cancelWithdrawal(
  userId: string,
  withdrawalId: string,
): Promise<WithdrawalStatus> {
  const updated = await prisma.$transaction(async (tx) => {
    // Atomic conditional claim: only PENDING withdrawals can be cancelled.
    // This eliminates the TOCTOU race between read + status check + update.
    const claimed = await tx.withdrawal.updateMany({
      where: { id: withdrawalId, userId, status: 'PENDING' },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    if (claimed.count === 0) {
      // Either not found or not PENDING — check which
      const existing = await tx.withdrawal.findFirst({
        where: { id: withdrawalId, userId },
        select: { status: true },
      });
      if (!existing) {
        throw new WithdrawalError('WITHDRAWAL_NOT_FOUND', 'Withdrawal not found');
      }
      throw new WithdrawalError('WITHDRAWAL_ALREADY_PROCESSING', `Cannot cancel withdrawal in status ${existing.status}`);
    }

    const withdrawal = await tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });

    await tx.balanceAccount.update({
      where: { userId },
      data: {
        availableBalancePence: { increment: withdrawal.amountPence },
        pendingBalancePence: { decrement: withdrawal.amountPence },
      },
    });

    const account = await tx.balanceAccount.findUniqueOrThrow({ where: { userId } });

    await tx.balanceEntry.create({
      data: {
        balanceAccountId: account.id,
        userId,
        type: 'WITHDRAWAL_REVERSAL',
        amountPence: withdrawal.amountPence,
        currency: 'GBP',
        direction: 'CREDIT',
        referenceType: 'WITHDRAWAL_REVERSAL',
        referenceId: withdrawal.id,
        description: 'Withdrawal cancelled by user',
      },
    });

    return withdrawal;
  });

  log.info({ userId, withdrawalId }, 'Withdrawal cancelled');

  return {
    id: updated.id,
    status: 'CANCELLED',
    amountPence: updated.amountPence,
    currency: updated.currency,
    stripePayoutId: updated.stripePayoutId,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
    completedAt: updated.completedAt?.toISOString() ?? null,
    failedAt: updated.failedAt?.toISOString() ?? null,
    failureReason: updated.reversalReason,
  };
}

// ---------------------------------------------------------------------------
// handlePayoutWebhook
// ---------------------------------------------------------------------------

export async function handlePayoutWebhook(params: {
  stripePayoutId: string;
  status: 'paid' | 'failed' | 'canceled';
  arrivalDate?: number;
}): Promise<void> {
  const { stripePayoutId, status } = params;

  const withdrawal = await prisma.withdrawal.findFirst({
    where: { stripePayoutId },
  });

  if (!withdrawal) {
    // P1 #6: Out-of-order webhook — payout.paid arrived before the
    // Withdrawal record was committed. Persist the observation so the
    // sweeper can reconcile it later when the Withdrawal appears.
    const existing = await prisma.payoutWebhookObservation.findUnique({
      where: { stripePayoutId },
    });
    if (!existing) {
      await prisma.payoutWebhookObservation.create({
        data: {
          stripePayoutId,
          status,
          arrivalDate: params.arrivalDate ?? null,
        },
      });
      log.info(
        { stripePayoutId, status },
        'Payout webhook for unknown withdrawal — persisted as pending observation',
      );
    } else {
      log.info(
        { stripePayoutId, status },
        'Payout observation already persisted — skipping duplicate',
      );
    }
    return;
  }

  // Idempotent: if the withdrawal is already in a terminal state, skip.
  if (withdrawal.status === 'COMPLETED' || withdrawal.status === 'FAILED') {
    log.info({ withdrawalId: withdrawal.id, status: withdrawal.status }, 'Withdrawal already terminal — skipping webhook');
    return;
  }

  if (status === 'paid') {
    const claimed = await prisma.withdrawal.updateMany({
      where: { id: withdrawal.id, status: 'PROCESSING' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    if (claimed.count === 0) return;

    await prisma.balanceAccount.update({
      where: { userId: withdrawal.userId },
      data: { pendingBalancePence: { decrement: withdrawal.amountPence } },
    });

    log.info(
      { withdrawalId: withdrawal.id, stripePayoutId },
      'Payout confirmed - withdrawal COMPLETED',
    );
  } else if (status === 'failed' || status === 'canceled') {
    const claimed = await prisma.withdrawal.updateMany({
      where: { id: withdrawal.id, status: 'PROCESSING' },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        reversalReason: `Payout ${status} by Stripe`,
      },
    });
    if (claimed.count === 0) return;

    await prisma.$transaction(async (tx) => {
      await tx.balanceAccount.update({
        where: { userId: withdrawal.userId },
        data: {
          availableBalancePence: { increment: withdrawal.amountPence },
          pendingBalancePence: { decrement: withdrawal.amountPence },
        },
      });

      const balanceAccount = await tx.balanceAccount.findUnique({
        where: { userId: withdrawal.userId },
      });

      await tx.balanceEntry.create({
        data: {
          balanceAccountId: balanceAccount!.id,
          userId: withdrawal.userId,
          type: 'WITHDRAWAL_REVERSAL',
          amountPence: withdrawal.amountPence,
          currency: 'GBP',
          direction: 'CREDIT',
          referenceType: 'WITHDRAWAL_REVERSAL',
          referenceId: withdrawal.id,
          description: `Payout ${status} by Stripe - funds returned`,
        },
      });
    });

    log.info(
      { withdrawalId: withdrawal.id, stripePayoutId, status },
      'Payout failed/cancelled - balance reversed',
    );
  }
}

// ---------------------------------------------------------------------------
// getUserWithdrawals
// ---------------------------------------------------------------------------

export async function getUserWithdrawals(
  userId: string,
  params: { cursor?: string; limit?: number } = {},
) {
  const limit = Math.min(params.limit ?? 20, 100);

  const withdrawals = await prisma.withdrawal.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      status: true,
      amountPence: true,
      currency: true,
      stripePayoutId: true,
      createdAt: true,
      completedAt: true,
      failedAt: true,
      reversalReason: true,
    },
  });

  const hasMore = withdrawals.length > limit;
  if (hasMore) withdrawals.pop();

  return {
    withdrawals,
    nextCursor: hasMore ? withdrawals[withdrawals.length - 1]?.id ?? null : null,
  };
}

// ---------------------------------------------------------------------------
// reconcileWithdrawals — crash recovery + out-of-order webhook handling
//
// Handles two scenarios:
//
// 1. CRASH RECOVERY (P1 #5): A withdrawal was created and the Stripe payout
//    was attempted, but the process crashed before `stripePayoutId` was
//    persisted. The withdrawal remains PENDING/PROCESSING without a payout
//    reference. The sweeper queries Stripe to determine the actual payout
//    state and reconciles.
//
// 2. OUT-OF-ORDER WEBHOOKS (P1 #6): A payout webhook arrived before the
//    Withdrawal record existed. The observation was persisted in
//    PayoutWebhookObservation. Now that the Withdrawal exists, reconcile it.
//
// Safety:
//   - Uses the same deterministic idempotency key for retry.
//   - Never creates duplicate payouts (Stripe idempotency prevents it).
//   - Marks ambiguous states as anomalies for manual review.
// ---------------------------------------------------------------------------

export async function reconcileWithdrawals(): Promise<number> {
  let reconciled = 0;

  // Find stale PENDING/PROCESSING withdrawals without a stripePayoutId
  // that are older than 15 minutes (gives the payout creation enough time
  // to complete normally).
  const staleThreshold = new Date(Date.now() - 15 * 60 * 1000);
  const staleWithdrawals = await prisma.withdrawal.findMany({
    where: {
      status: { in: ['PENDING', 'PROCESSING'] },
      stripePayoutId: null,
      createdAt: { lt: staleThreshold },
    },
    include: { payoutMethod: true },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });

  for (const withdrawal of staleWithdrawals) {
    try {
      // Determine the connected account for this user
      const connectedAccount = await prisma.connectedAccount.findUnique({
        where: { userId: withdrawal.userId },
      });
      if (!connectedAccount) {
        log.error(
          { withdrawalId: withdrawal.id, userId: withdrawal.userId },
          'ANOMALY: Stale withdrawal with no connected account',
        );
        continue;
      }

      // Try to create the payout with the SAME deterministic idempotency key.
      // If Stripe already has a payout for this key, it returns the existing
      // one (idempotent). If not, it creates a new one.
      try {
        const payout = await createPayout({
          connectedAccountId: connectedAccount.stripeAccountId,
          amountPence: withdrawal.amountPence,
          idempotencyKey: withdrawal.idempotencyKey,
        });

        await prisma.withdrawal.update({
          where: { id: withdrawal.id },
          data: {
            status: 'PROCESSING',
            stripePayoutId: payout.payoutId,
            processedAt: new Date(),
          },
        });

        log.info(
          { withdrawalId: withdrawal.id, payoutId: payout.payoutId },
          'Reconciled stale withdrawal — payout created/found',
        );
        reconciled++;
      } catch (err) {
        // If the payout creation fails (e.g. insufficient funds on connected
        // account), mark the withdrawal as FAILED and reverse the balance.
        const message = err instanceof Error ? err.message : String(err);
        log.error(
          { err, withdrawalId: withdrawal.id },
          'Stale withdrawal payout reconciliation failed — marking as FAILED',
        );

        await prisma.$transaction(async (tx) => {
          await tx.withdrawal.update({
            where: { id: withdrawal.id },
            data: { status: 'FAILED', failedAt: new Date(), reversalReason: message },
          });

          await tx.balanceAccount.update({
            where: { userId: withdrawal.userId },
            data: {
              availableBalancePence: { increment: withdrawal.amountPence },
              pendingBalancePence: { decrement: withdrawal.amountPence },
            },
          });

          const balanceAccount = await tx.balanceAccount.findUnique({
            where: { userId: withdrawal.userId },
          });

          await tx.balanceEntry.create({
            data: {
              balanceAccountId: balanceAccount!.id,
              userId: withdrawal.userId,
              type: 'WITHDRAWAL_REVERSAL',
              amountPence: withdrawal.amountPence,
              currency: 'GBP',
              direction: 'CREDIT',
              referenceType: 'WITHDRAWAL_REVERSAL',
              referenceId: withdrawal.id,
              description: `Payout reconciliation failed: ${message}`,
            },
          });
        });
        reconciled++;
      }
    } catch (err) {
      log.error(
        { err, withdrawalId: withdrawal.id },
        'Failed to reconcile stale withdrawal',
      );
    }
  }

  // P1 #6: Consume pending payout webhook observations.
  // Match them against withdrawals that now have a stripePayoutId.
  const unconsumed = await prisma.payoutWebhookObservation.findMany({
    where: { consumed: false },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });

  for (const obs of unconsumed) {
    try {
      const withdrawal = await prisma.withdrawal.findFirst({
        where: { stripePayoutId: obs.stripePayoutId },
      });

      if (!withdrawal) {
        // No matching withdrawal yet — will be retried in next sweep cycle
        continue;
      }

      // Apply the webhook event to the withdrawal
      await handlePayoutWebhook({
        stripePayoutId: obs.stripePayoutId,
        status: obs.status as 'paid' | 'failed' | 'canceled',
        arrivalDate: obs.arrivalDate ?? undefined,
      });

      await prisma.payoutWebhookObservation.update({
        where: { id: obs.id },
        data: { consumed: true, consumedAt: new Date() },
      });

      reconciled++;
    } catch (err) {
      log.error(
        { err, observationId: obs.id, stripePayoutId: obs.stripePayoutId },
        'Failed to consume pending payout observation',
      );
    }
  }

  return reconciled;
}
