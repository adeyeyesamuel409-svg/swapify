// ---------------------------------------------------------------------------
// Withdrawal service
//
// Manages the full withdrawal lifecycle: validation, balance deduction,
// Stripe payout creation, status tracking, and failure reversal.
//
// Flow (R1 state machine):
//   1. User requests withdrawal -> validate balance + connected account
//   2. Single tx: create Withdrawal (PENDING), move available -> pending,
//      write WITHDRAWAL_DEBIT
//   3. Conditional update: CAS PENDING -> PAYOUT_CREATING (durable claim).
//      If this CAS loses to cancelWithdrawal, NO Stripe call is made.
//   4. Stripe payout created with the deterministic idempotencyKey
//      -> CAS PAYOUT_CREATING -> PROCESSING + stripePayoutId
//   5. Webhook: paid -> COMPLETED (phase A) then release reservation + settledAt
//                     (phase B, separately recoverable)
//                failed/canceled -> single tx: FAILED + reversedAt + reversal
//
// Idempotency:
//   - Withdrawal.idempotencyKey is the Stripe payout idempotency key
//   - Duplicate requests rejected at validation layer
//   - payoutClaimId is a claim marker, NOT an idempotency key
//
// Financial invariants (see docs in the R1 design):
//   I-P  pendingBalancePence == SUM(amountPence) WHERE settledAt IS NULL
//   I-S  settledAt IS NOT NULL  <=>  reservation released exactly once
//   I-R  reversedAt IS NOT NULL <=>  reversal fully represented (available
//        returned, pending released, WITHDRAWAL_REVERSAL entry present)
//   I-L  at most one WITHDRAWAL_REVERSAL entry per withdrawal
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
// Payout-creation result classification
//
// After a Stripe payout attempt we must distinguish three cases, because a
// timeout does NOT imply Stripe did not create the payout:
//
//   definite    Stripe answered with a definitive rejection (4xx invalid
//               request / auth / permission). The request was received and
//               refused, so no payout exists and the reservation can be
//               returned safely.
//   unknown     Process death, timeout, connection reset, 5xx, 429, or any
//               error we cannot attribute. A payout MAY exist. The withdrawal
//               stays in PAYOUT_CREATING and reconciliation resolves it by
//               re-issuing the SAME deterministic idempotency key, which
//               Stripe deduplicates -- so it can never produce a second payout.
//
// The boundary message thrown by createPayout() before any network call is
// also "definite": nothing left the process.
// ---------------------------------------------------------------------------

export type PayoutCreationOutcome = 'created' | 'definite-rejection' | 'unknown';

const DEFINITE_REJECTION_STATUS = 400;
const DEFINITE_REJECTION_MAX = 499;
// 408 Request Timeout and 429 Too Many Requests are deliberately NOT treated
// as definite: they are transport-level outcomes where we cannot prove from
// the response alone that no payout object exists, so the claim is held and
// reconciliation re-issues the same idempotency key instead.
const DEFERRED_4XX_STATUS = new Set([408, 429]);

export function classifyPayoutCreationError(err: unknown): PayoutCreationOutcome {
  if (!(err instanceof Error)) return 'unknown';

  // createPayout() guards on stripeEnabled before any network I/O.
  if (err.message.includes('Stripe is not configured')) return 'definite-rejection';

  const anyErr = err as Error & {
    statusCode?: number;
    type?: string;
    code?: string;
    rawType?: string;
  };

  // Errors carrying a 4xx HTTP status were answered by Stripe: the request
  // reached Stripe and was refused, so no payout object was created.
  if (
    typeof anyErr.statusCode === 'number' &&
    anyErr.statusCode >= DEFINITE_REJECTION_STATUS &&
    anyErr.statusCode <= DEFINITE_REJECTION_MAX &&
    !DEFERRED_4XX_STATUS.has(anyErr.statusCode)
  ) {
    return 'definite-rejection';
  }

  return 'unknown';
}

// Stripe idempotency keys are honoured for 24h. Retry well inside that window
// so a re-issued createPayout() is guaranteed to resolve to the ORIGINAL payout
// rather than creating a new one. Outside this window we never retry blindly.
const STRIPE_IDEMPOTENCY_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

// How long a PAYOUT_CREATING claim may sit before reconciliation acts on it.
// Gives a normal request plenty of time to finish its own Stripe call first.
const PAYOUT_CLAIM_STALE_MS = 15 * 60 * 1000;

// Batch bounds for one reconciliation sweep.
const MAX_RECONCILE_BATCH = 20;

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
  | 'WITHDRAWAL_CANCELLED'
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
// Shared financial transitions
//
// There are exactly three balance-moving operations for a withdrawal, and each
// is guarded by a CAS on the marker that proves it has not already happened:
//
//   settleCompletedWithdrawal  releases the pending reservation for a paid
//                              payout; CAS on settledAt IS NULL
//   reverseWithdrawal          returns the reservation for a failed/cancelled
//                              withdrawal; CAS on reversedAt IS NULL
//   reserveWithdrawal          (inside requestWithdrawal) moves available ->
//                              pending; CAS on sufficient balance
//
// Because every marker is written in the SAME transaction as the balance
// movement it authorises, a crash can never leave a terminal status whose
// financial effect is missing, and a retry can never apply it twice.
// ---------------------------------------------------------------------------

/**
 * Phase B of payout.paid: release the pending reservation exactly once.
 *
 * Called for a withdrawal that is already in status COMPLETED (phase A has
 * committed). Safe to call repeatedly: the CAS on settledAt IS NULL means only
 * the first caller performs the balance movement, and the movement and the
 * marker are written in one transaction so they cannot separate.
 */
async function settleCompletedWithdrawal(withdrawalId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    // Claim first: the CAS blocks on the row lock and re-evaluates
    // settledAt = NULL after any concurrent committer, so a losing writer
    // returns false without ever touching the balance.
    const claimed = await tx.withdrawal.updateMany({
      where: { id: withdrawalId, status: 'COMPLETED', settledAt: null },
      data: { settledAt: new Date() },
    });
    if (claimed.count === 0) return false; // already settled, or not COMPLETED

    const withdrawal = await tx.withdrawal.findUniqueOrThrow({
      where: { id: withdrawalId },
      select: { userId: true, amountPence: true },
    });

    const released = await tx.balanceAccount.updateMany({
      where: { userId: withdrawal.userId, pendingBalancePence: { gte: withdrawal.amountPence } },
      data: { pendingBalancePence: { decrement: withdrawal.amountPence } },
    });
    if (released.count === 0) {
      // Invariant I-P already breached: the reservation this settlement is
      // owed is not held. Roll back the claim so the state stays repairable
      // and surface the breach loudly instead of papering over it.
      throw new Error(
        `settleCompletedWithdrawal: reservation for ${withdrawalId} is not held — pendingBalancePence below ${withdrawal.amountPence}`,
      );
    }

    return true;
  });
}

/**
 * Reverse a withdrawal's reservation exactly once.
 *
 * Produces, atomically:
 *   - reversedAt + terminal status (+ failedAt/cancelledAt)
 *   - availableBalancePence incremented
 *   - pendingBalancePence decremented
 *   - settledAt (this withdrawal no longer counts towards I-P)
 *   - exactly one WITHDRAWAL_REVERSAL BalanceEntry (referenceId = withdrawal.id)
 *
 * `settledAt IS NULL` is the proof that the reservation is still held: it is
 * written in the same transaction as the movement that releases it, and the
 * migration backfills it for every pre-R1 withdrawal whose reversal already
 * committed. A pre-existing WITHDRAWAL_REVERSAL row therefore never causes a
 * second credit — if the funds were already returned the markers are written
 * alone; if the entry exists but the funds were never returned, the balance
 * moves without inserting a duplicate entry.
 */
async function reverseWithdrawal(
  withdrawalId: string,
  reason: string,
  mode: 'failed' | 'cancelled',
  expectedStatuses: Array<'PENDING' | 'PAYOUT_CREATING' | 'PROCESSING' | 'FAILED' | 'CANCELLED'>,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    // Claim first, on the marker that proves the reversal has never been
    // recorded. Blocks on the row lock, so a concurrent committer makes this
    // return false without touching the balance.
    const claimed = await tx.withdrawal.updateMany({
      where: { id: withdrawalId, reversedAt: null, status: { in: expectedStatuses } },
      data: {
        status: mode === 'failed' ? 'FAILED' : 'CANCELLED',
        reversedAt: new Date(),
        reversalReason: reason,
        ...(mode === 'failed' ? { failedAt: new Date() } : { cancelledAt: new Date() }),
      },
    });

    if (claimed.count === 0) return false; // already reversed, or not ours to reverse

    const withdrawal = await tx.withdrawal.findUniqueOrThrow({
      where: { id: withdrawalId },
    });

    if (withdrawal.settledAt) {
      // The reservation was released by an earlier committed transaction (the
      // migration backfills settledAt for exactly this case). Writing the
      // markers was all that was missing — never credit twice.
      log.warn(
        { withdrawalId: withdrawal.id },
        'Reversal already settled — status markers only, no second credit',
      );
      return true;
    }

    // The reservation being returned is held in pendingBalancePence (I-P: a
    // withdrawal with settledAt IS NULL is counted there). Returning it must
    // never drive pending negative — that would mean the reservation was
    // already released while reversedAt was still null, i.e. an I-P breach
    // that must be surfaced rather than hidden.
    const released = await tx.balanceAccount.updateMany({
      where: {
        userId: withdrawal.userId,
        pendingBalancePence: { gte: withdrawal.amountPence },
      },
      data: {
        availableBalancePence: { increment: withdrawal.amountPence },
        pendingBalancePence: { decrement: withdrawal.amountPence },
      },
    });
    if (released.count === 0) {
      throw new Error(
        `reverseWithdrawal: reservation for ${withdrawalId} is not held — pendingBalancePence below ${withdrawal.amountPence}`,
      );
    }

    await tx.withdrawal.update({
      where: { id: withdrawalId },
      data: { settledAt: new Date() },
    });

    const existingEntry = await tx.balanceEntry.findUnique({
      where: {
        referenceType_referenceId: {
          referenceType: 'WITHDRAWAL_REVERSAL',
          referenceId: withdrawal.id,
        },
      },
      select: { id: true },
    });
    if (existingEntry) {
      // The entry already records this reversal. The balance movement above is
      // the one this transaction owns; the entry is its record. Never insert
      // a second one (I-L).
      log.warn(
        { withdrawalId: withdrawal.id },
        'WITHDRAWAL_REVERSAL already recorded — balance returned without a duplicate entry',
      );
      return true;
    }

    const account = await tx.balanceAccount.findUniqueOrThrow({
      where: { userId: withdrawal.userId },
    });

    await tx.balanceEntry.create({
      data: {
        balanceAccountId: account.id,
        userId: withdrawal.userId,
        type: 'WITHDRAWAL_REVERSAL',
        amountPence: withdrawal.amountPence,
        currency: withdrawal.currency,
        direction: 'CREDIT',
        referenceType: 'WITHDRAWAL_REVERSAL',
        referenceId: withdrawal.id,
        description: reason,
      },
    });

    return true;
  });
}

/**
 * Attempt the Stripe payout for an already-claimed withdrawal.
 *
 * The claim (PAYOUT_CREATING) MUST already be committed when this is called.
 * Returns the created payout id, or null when the outcome was a definite
 * rejection (reservation returned) or unknown (left for reconciliation).
 */
async function attemptStripePayout(params: {
  withdrawal: { id: string; userId: string; amountPence: number; idempotencyKey: string };
  stripeAccountId: string;
}): Promise<{ payoutId: string } | { rejected: true } | { unknown: true }> {
  const { withdrawal, stripeAccountId } = params;

  try {
    const payout = await createPayout({
      connectedAccountId: stripeAccountId,
      amountPence: withdrawal.amountPence,
      idempotencyKey: withdrawal.idempotencyKey,
    });

    // CAS -> PROCESSING + stripePayoutId. PAYOUT_CREATING is the R1 claim;
    // legacy PROCESSING with no reference is a pre-R1 crash that never
    // persisted the payout id. If a concurrent writer already persisted a
    // payout reference, keep theirs.
    const advanced = await prisma.withdrawal.updateMany({
      where: {
        id: withdrawal.id,
        stripePayoutId: null,
        status: { in: ['PAYOUT_CREATING', 'PROCESSING'] },
      },
      data: {
        status: 'PROCESSING',
        stripePayoutId: payout.payoutId,
        processedAt: new Date(),
      },
    });

    if (advanced.count === 0) {
      // A Stripe payout now exists but the row did not accept the reference.
      // Nothing is stranded: the withdrawal's own idempotency key means a
      // later retry resolves to this same payout, but the anomaly is surfaced
      // rather than hidden.
      const current = await prisma.withdrawal.findUnique({
        where: { id: withdrawal.id },
        select: { status: true, stripePayoutId: true },
      });
      if (!current?.stripePayoutId) {
        log.error(
          { withdrawalId: withdrawal.id, payoutId: payout.payoutId, current },
          'ANOMALY: payout created but withdrawal reference not persisted',
        );
      } else {
        log.warn(
          { withdrawalId: withdrawal.id, payoutId: payout.payoutId },
          'Payout created but row already advanced — keeping existing reference',
        );
      }
    }

    return { payoutId: payout.payoutId };
  } catch (err) {
    const outcome = classifyPayoutCreationError(err);
    const message = err instanceof Error ? err.message : String(err);

    if (outcome === 'definite-rejection') {
      // Stripe refused the request: no payout exists. Return the funds.
      log.error(
        { err, withdrawalId: withdrawal.id },
        'Stripe payout rejected definitively — reversing reservation',
      );
      await reverseWithdrawal(withdrawal.id, `Payout rejected: ${message}`, 'failed', [
        'PENDING',
        'PAYOUT_CREATING',
        'PROCESSING',
        'FAILED',
      ]);
      return { rejected: true };
    }

    // Unknown: a payout MAY exist. Leave the claim in place; reconciliation
    // re-issues the SAME idempotency key, which Stripe deduplicates.
    log.error(
      { err, withdrawalId: withdrawal.id },
      'Stripe payout outcome unknown — leaving PAYOUT_CREATING for reconciliation',
    );
    return { unknown: true };
  }
}

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
    'Withdrawal created, claiming for payout',
  );

  // ---- BLOCKER 3 FIX: durable claim BEFORE any Stripe call -----------------
  // PENDING -> PAYOUT_CREATING is a CAS on the same row that cancelWithdrawal
  // claims. Exactly one of {cancel, claim} can win, so a cancellation can
  // never return the reservation while a payout is subsequently created
  // against it.
  const claimed = await prisma.withdrawal.updateMany({
    where: { id: result.id, userId, status: 'PENDING', stripePayoutId: null },
    data: {
      status: 'PAYOUT_CREATING',
      payoutClaimedAt: new Date(),
      payoutClaimId: `claim:${result.id}`,
    },
  });

  if (claimed.count === 0) {
    // cancelWithdrawal won the race. No Stripe call is made. The reservation
    // has already been returned by the cancelling transaction.
    log.info({ userId, withdrawalId: result.id }, 'Withdrawal cancelled before payout claim');
    throw new WithdrawalError('WITHDRAWAL_CANCELLED', 'Withdrawal was cancelled');
  }

  const outcome = await attemptStripePayout({
    withdrawal: {
      id: result.id,
      userId,
      amountPence,
      idempotencyKey,
    },
    stripeAccountId: connectedAccount.stripeAccountId,
  });

  if ('payoutId' in outcome) {
    log.info(
      { userId, withdrawalId: result.id, payoutId: outcome.payoutId },
      'Stripe payout created',
    );
    return {
      id: result.id,
      status: 'PROCESSING',
      amountPence,
      createdAt: result.createdAt.toISOString(),
    };
  }

  if ('rejected' in outcome) {
    // Reservation returned by attemptStripePayout. Surface the failure.
    throw new WithdrawalError('WITHDRAWAL_FAILED', 'Payout was rejected by Stripe');
  }

  // Unknown outcome: the claim stays durable so reconciliation can resolve it.
  return {
    id: result.id,
    status: 'PAYOUT_CREATING',
    amountPence,
    createdAt: result.createdAt.toISOString(),
  };
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
  const existing = await prisma.withdrawal.findFirst({
    where: { id: withdrawalId, userId },
    select: { id: true, status: true },
  });
  if (!existing) {
    throw new WithdrawalError('WITHDRAWAL_NOT_FOUND', 'Withdrawal not found');
  }

  // BLOCKER 3 FIX: the claim is a CAS on `status = PENDING` only. It is the
  // same row and the same predicate that the payout claim in requestWithdrawal
  // uses, so the database serialises them and exactly one can win:
  //
  //   cancel wins  -> status CANCELLED, reservation returned, and the payout
  //                   claim (WHERE status = 'PENDING') subsequently returns
  //                   count 0, so no Stripe payout is ever created.
  //   claim wins   -> status PAYOUT_CREATING, cancel returns
  //                   WITHDRAWAL_ALREADY_PROCESSING and returns no funds.
  //
  // There is therefore no interleaving in which funds are returned AND a
  // payout is created against the same reservation.
  const reversed = await reverseWithdrawal(
    withdrawalId,
    'Withdrawal cancelled by user',
    'cancelled',
    ['PENDING'],
  );

  if (!reversed) {
    const current = await prisma.withdrawal.findFirst({
      where: { id: withdrawalId, userId },
      select: { status: true, reversedAt: true },
    });
    if (current?.reversedAt) {
      // Already cancelled/reversed — idempotent success.
      const withdrawal = await prisma.withdrawal.findUniqueOrThrow({
        where: { id: withdrawalId },
      });
      return toWithdrawalStatus(withdrawal);
    }
    throw new WithdrawalError(
      'WITHDRAWAL_ALREADY_PROCESSING',
      `Cannot cancel withdrawal in status ${current?.status ?? 'unknown'}`,
    );
  }

  log.info({ userId, withdrawalId }, 'Withdrawal cancelled');

  const withdrawal = await prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
  return toWithdrawalStatus(withdrawal);
}

function toWithdrawalStatus(withdrawal: {
  id: string;
  status: string;
  amountPence: number;
  currency: string;
  stripePayoutId: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  failedAt: Date | null;
  reversedAt: Date | null;
  reversalReason: string | null;
}): WithdrawalStatus {
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

  // Idempotent + recoverable: terminal status alone is NOT proof that the
  // financial transition happened. Each branch below therefore keys on the
  // marker that proves it (settledAt / reversedAt), so a redelivery or a retry
  // after a partial failure repairs the missing movement instead of skipping.
  if (status === 'paid') {
    // Phase A — status only. CAS requires PROCESSING + this exact payout id,
    // so this is a no-op when the row is already COMPLETED (redelivery) or is
    // in a state this event does not describe.
    const advanced = await prisma.withdrawal.updateMany({
      where: {
        id: withdrawal.id,
        status: 'PROCESSING',
        settledAt: null,
        stripePayoutId,
      },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    // Re-read: phase A may have been applied by a concurrent writer, or the
    // row may simply already be COMPLETED from an earlier delivery.
    const current = await prisma.withdrawal.findUniqueOrThrow({
      where: { id: withdrawal.id },
      select: { id: true, status: true, stripePayoutId: true },
    });

    if (current.status !== 'COMPLETED' || current.stripePayoutId !== stripePayoutId) {
      log.info(
        { withdrawalId: withdrawal.id, status: current.status, stripePayoutId },
        'payout.paid does not describe this withdrawal — no transition applied',
      );
      return;
    }

    // Phase B — release the reservation exactly once. Safe on redelivery and
    // repairs the case where phase A committed but the balance operation did
    // not (P2 BLOCKER 1). Guaranteed no-op unless status is COMPLETED and
    // settledAt IS NULL.
    const settled = await settleCompletedWithdrawal(withdrawal.id);

    if (advanced.count > 0 || settled) {
      log.info(
        { withdrawalId: withdrawal.id, stripePayoutId },
        'Payout confirmed - withdrawal COMPLETED and reservation released',
      );
    } else {
      log.info(
        { withdrawalId: withdrawal.id, stripePayoutId },
        'Payout confirmed - reservation already released (idempotent redelivery)',
      );
    }
    return;
  }

  if (status === 'failed' || status === 'canceled') {
    // Single transaction: terminal status + reversedAt + available returned +
    // pending released + WITHDRAWAL_REVERSAL entry. payout.canceled keeps its
    // long-standing mapping to FAILED. An entry that already exists records the
    // same reversal, so it is reused instead of duplicated (I-L) while the
    // balance movement still happens exactly once.
    const reversed = await reverseWithdrawal(
      withdrawal.id,
      `Payout ${status} by Stripe - funds returned`,
      'failed',
      ['PAYOUT_CREATING', 'PROCESSING', 'FAILED'],
    );

    if (reversed) {
      log.info(
        { withdrawalId: withdrawal.id, stripePayoutId, status },
        'Payout failed/cancelled - reservation reversed',
      );
    } else {
      log.info(
        { withdrawalId: withdrawal.id, stripePayoutId, status, current: withdrawal.status },
        'Payout failed/cancelled - already reversed or not applicable (idempotent redelivery)',
      );
    }
    return;
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
// Every branch repairs a *missing financial movement*, keyed on the marker that
// proves it. None of them blindly retries an unsafe transition.
//
// 1. PENDING, never claimed. With R1 the claim is taken before any Stripe
//    call, so nothing has been sent; claiming and creating the payout here is
//    safe. For a pre-R1 row the same deterministic idempotency key protects
//    the retry.
//
// 2. Unknown outcome — PAYOUT_CREATING (R1: Stripe accepted, but the process
//    died before stripePayoutId was persisted) or legacy PROCESSING with no
//    stripePayoutId. The SAME idempotency key is re-issued, so Stripe returns
//    the original payout instead of creating a second one. This is only done
//    inside STRIPE_IDEMPOTENCY_RETRY_WINDOW_MS: Stripe's idempotency window is
//    ~24h, so beyond 23h the same key would create a NEW payout. Outside the
//    window: ANOMALY, manual review — never a second payout.
//
// 3. COMPLETED with settledAt IS NULL: the status committed but the
//    reservation was never released (P2 BLOCKER 1). Release it exactly once.
//
// 4. FAILED/CANCELLED with reversedAt IS NULL: a terminal status with no
//    recorded reversal (P2 BLOCKER 2). Record it exactly once; if the
//    WITHDRAWAL_REVERSAL entry already exists, only the markers are written.
//
// 5. OUT-OF-ORDER WEBHOOKS (P1 #6): a payout webhook arrived before the
//    Withdrawal existed; the persisted observation is consumed once a
//    withdrawal carries that stripePayoutId.
//
// Safety:
//   - Every Stripe call reuses the deterministic idempotency key.
//   - Every DB transition is a conditional updateMany (CAS) on a marker.
//   - Ambiguous states are logged as ANOMALY for manual review.
// ---------------------------------------------------------------------------

export async function reconcileWithdrawals(): Promise<number> {
  let reconciled = 0;
  const now = Date.now();
  const staleThreshold = new Date(now - PAYOUT_CLAIM_STALE_MS);
  const retryCutoff = new Date(now - STRIPE_IDEMPOTENCY_RETRY_WINDOW_MS);

  // ---- 1 + 2: withdrawals whose payout has not been confirmed ---------------
  const candidates = await prisma.withdrawal.findMany({
    where: {
      stripePayoutId: null,
      OR: [
        { status: 'PENDING', payoutClaimedAt: null, createdAt: { lt: staleThreshold } },
        { status: 'PAYOUT_CREATING', payoutClaimedAt: { lt: staleThreshold } },
        { status: 'PROCESSING', createdAt: { lt: staleThreshold } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: MAX_RECONCILE_BATCH,
  });

  for (const withdrawal of candidates) {
    try {
      // A Stripe call may already have been made for this row only if a claim
      // exists (R1) or it is a pre-R1 PROCESSING row.
      const payoutAttempted =
        withdrawal.status === 'PAYOUT_CREATING' ||
        withdrawal.payoutClaimedAt !== null ||
        withdrawal.status === 'PROCESSING';

      if (payoutAttempted) {
        const claimedAt = withdrawal.payoutClaimedAt ?? withdrawal.createdAt;
        if (claimedAt < retryCutoff) {
          log.error(
            { withdrawalId: withdrawal.id, status: withdrawal.status, claimedAt },
            'ANOMALY: payout outcome unknown beyond Stripe idempotency window — manual review required, no retry issued',
          );
          continue;
        }
      }

      const connectedAccount = await prisma.connectedAccount.findUnique({
        where: { userId: withdrawal.userId },
      });
      if (!connectedAccount) {
        log.error(
          { withdrawalId: withdrawal.id, userId: withdrawal.userId },
          'ANOMALY: stale withdrawal with no connected account — manual review required',
        );
        continue;
      }

      // Establish the durable claim. A PENDING row has had no Stripe call
      // (the claim precedes createPayout) and a legacy PROCESSING row with no
      // reference points at no payout, so neither can be double-created here.
      // A concurrent cancellation or payout claim makes this count === 0.
      // A row already in PAYOUT_CREATING keeps its claim and falls through.
      if (withdrawal.status !== 'PAYOUT_CREATING') {
        const claimed = await prisma.withdrawal.updateMany({
          where: {
            id: withdrawal.id,
            stripePayoutId: null,
            status: { in: ['PENDING', 'PROCESSING'] },
          },
          data: {
            status: 'PAYOUT_CREATING',
            payoutClaimedAt:
              withdrawal.payoutClaimedAt ??
              (withdrawal.status === 'PROCESSING' ? withdrawal.createdAt : new Date()),
            payoutClaimId: `claim:${withdrawal.id}`,
          },
        });
        if (claimed.count === 0) continue; // raced; the next sweep re-evaluates
      }

      // Re-verify immediately before the external call. Once a row reads
      // PAYOUT_CREATING the reservation can never be returned (cancelWithdrawal
      // only claims PENDING), so this is the last point at which the state can
      // still move under us.
      const current = await prisma.withdrawal.findUnique({
        where: { id: withdrawal.id },
        select: { status: true, stripePayoutId: true },
      });
      if (!current || current.status !== 'PAYOUT_CREATING' || current.stripePayoutId) {
        continue;
      }

      const outcome = await attemptStripePayout({
        withdrawal: {
          id: withdrawal.id,
          userId: withdrawal.userId,
          amountPence: withdrawal.amountPence,
          idempotencyKey: withdrawal.idempotencyKey,
        },
        stripeAccountId: connectedAccount.stripeAccountId,
      });

      if ('payoutId' in outcome) {
        log.info(
          { withdrawalId: withdrawal.id, payoutId: outcome.payoutId },
          'Reconciled withdrawal — payout resolved under the original idempotency key',
        );
        reconciled++;
      } else if ('rejected' in outcome) {
        log.info(
          { withdrawalId: withdrawal.id },
          'Reconciled withdrawal — Stripe rejected the payout, reservation returned',
        );
        reconciled++;
      } else {
        log.warn(
          { withdrawalId: withdrawal.id },
          'Payout outcome still unknown — claim left in place for the next sweep',
        );
      }
    } catch (err) {
      log.error({ err, withdrawalId: withdrawal.id }, 'Failed to reconcile withdrawal');
    }
  }

  // ---- 3: COMPLETED with an unreleased reservation (P2 BLOCKER 1) -----------
  const unsettled = await prisma.withdrawal.findMany({
    where: { status: 'COMPLETED', settledAt: null },
    orderBy: { createdAt: 'asc' },
    take: MAX_RECONCILE_BATCH,
    select: { id: true },
  });

  for (const { id } of unsettled) {
    try {
      if (await settleCompletedWithdrawal(id)) {
        log.warn({ withdrawalId: id }, 'Repaired COMPLETED withdrawal whose reservation was never released');
        reconciled++;
      }
    } catch (err) {
      log.error(
        { err, withdrawalId: id },
        'ANOMALY: could not release reservation for COMPLETED withdrawal — manual review required',
      );
    }
  }

  // ---- 4: terminal status with no recorded reversal (P2 BLOCKER 2) ----------
  const unreversed = await prisma.withdrawal.findMany({
    where: { status: { in: ['FAILED', 'CANCELLED'] }, reversedAt: null },
    orderBy: { createdAt: 'asc' },
    take: MAX_RECONCILE_BATCH,
    select: { id: true, status: true },
  });

  for (const withdrawal of unreversed) {
    const mode = withdrawal.status === 'FAILED' ? 'failed' : 'cancelled';
    try {
      const reversed = await reverseWithdrawal(
        withdrawal.id,
        mode === 'failed'
          ? 'Reservation reversal recorded by reconciliation'
          : 'Withdrawal cancelled by user',
        mode,
        [withdrawal.status === 'FAILED' ? 'FAILED' : 'CANCELLED'],
      );
      if (reversed) {
        log.warn(
          { withdrawalId: withdrawal.id, status: withdrawal.status },
          'Repaired terminal withdrawal that had no recorded reversal',
        );
        reconciled++;
      }
    } catch (err) {
      log.error(
        { err, withdrawalId: withdrawal.id },
        'ANOMALY: could not record reversal for terminal withdrawal — manual review required',
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
