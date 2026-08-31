import { ValueGapState, ShipmentStatus, PaymentStatus, Prisma, prisma } from '@swapify/db';
import { creditValueGap } from './balance.js';
import pino from 'pino';

const log = pino({ name: 'value-gap', level: process.env.LOG_LEVEL ?? 'info' });

// ---------------------------------------------------------------------------
// Disbursement provider abstraction
//
// Future payout providers (Stripe Connect, bank transfer, PayPal, etc.) will
// implement this interface. The current implementation is a placeholder that
// returns PENDING_EXTERNAL_DISBURSEMENT without performing any real transfer.
// ---------------------------------------------------------------------------

export interface DisbursementReleaseResult {
  status: 'PENDING_EXTERNAL_DISBURSEMENT' | 'FAILED' | 'COMPLETED';
  externalRef?: string;
  error?: string;
}

export interface DisbursementProvider {
  release(params: {
    valueGapId: string;
    recipientUserId: string;
    valueGapPence: number;
    currency: string;
  }): Promise<DisbursementReleaseResult>;

  refund(params: {
    valueGapId: string;
    payerUserId: string;
    valueGapPence: number;
    currency: string;
  }): Promise<DisbursementReleaseResult>;
}

// Placeholder implementation — does NOT perform real external payouts.
// Replace this with a real provider when the disbursement model is decided.
const placeholderProvider: DisbursementProvider = {
  async release() {
    log.info('Disbursement provider placeholder: release would be called here');
    return { status: 'PENDING_EXTERNAL_DISBURSEMENT' };
  },
  async refund() {
    log.info('Disbursement provider placeholder: refund would be called here');
    return { status: 'PENDING_EXTERNAL_DISBURSEMENT' };
  },
};

let disbursementProvider: DisbursementProvider = placeholderProvider;

export function setDisbursementProvider(provider: DisbursementProvider): void {
  disbursementProvider = provider;
}

export function getDisbursementProvider(): DisbursementProvider {
  return disbursementProvider;
}

// ---------------------------------------------------------------------------
// Valid state transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<ValueGapState, ValueGapState[]> = {
  PENDING: [ValueGapState.HELD, ValueGapState.REFUNDED],
  HELD: [ValueGapState.RELEASED, ValueGapState.REFUNDED],
  RELEASED: [], // terminal — no transitions allowed
  REFUNDED: [], // terminal — no transitions allowed
};

function isValidTransition(from: ValueGapState, to: ValueGapState): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Audit log helper
// ---------------------------------------------------------------------------

function auditLog(params: {
  swapId: string;
  paymentId: string;
  payerUserId: string;
  recipientUserId: string;
  valueGapPence: number;
  previousState: ValueGapState;
  newState: ValueGapState;
  reason: string;
}): void {
  log.info(
    {
      swapId: params.swapId,
      paymentId: params.paymentId,
      payerUserId: params.payerUserId,
      recipientUserId: params.recipientUserId,
      valueGapPence: params.valueGapPence,
      previousState: params.previousState,
      newState: params.newState,
      reason: params.reason,
    },
    `ValueGap state transition: ${params.previousState} → ${params.newState}`,
  );
}

// ---------------------------------------------------------------------------
// allocateValueGap — PENDING → HELD
//
// Called when Stripe confirms the value-gap payment. Creates the internal
// ledger record atomically with the payment confirmation. The recipient is
// snapshot from the swap agreement at this point.
//
// Idempotent: if a ValueGap already exists for this paymentId, returns it.
// ---------------------------------------------------------------------------

export async function allocateValueGap(
  tx: Prisma.TransactionClient,
  params: {
    paymentId: string;
    swapId: string;
    payerUserId: string;
    valueGapPence: number;
    serviceFeePence: number;
  },
): Promise<void> {
  const existing = await tx.valueGap.findUnique({
    where: { paymentId: params.paymentId },
  });

  if (existing) {
    // Already allocated — idempotent no-op
    log.info({ paymentId: params.paymentId, state: existing.state }, 'ValueGap already exists for payment');
    return;
  }

  // Snapshot the recipient from the swap agreement.
  // The payer is the one who owes the gap; the recipient is the other party.
  const swap = await tx.swap.findUniqueOrThrow({
    where: { id: params.swapId },
    select: { offeringUserId: true, requestedUserId: true, gapPayer: true },
  });

  const recipientUserId =
    swap.gapPayer === 'OFFERING_USER' ? swap.requestedUserId : swap.offeringUserId;

  const now = new Date();

  await tx.valueGap.create({
    data: {
      paymentId: params.paymentId,
      swapId: params.swapId,
      payerUserId: params.payerUserId,
      recipientUserId,
      valueGapPence: params.valueGapPence,
      serviceFeePence: params.serviceFeePence,
      state: ValueGapState.HELD,
      heldAt: now,
    },
  });

  auditLog({
    swapId: params.swapId,
    paymentId: params.paymentId,
    payerUserId: params.payerUserId,
    recipientUserId,
    valueGapPence: params.valueGapPence,
    previousState: ValueGapState.PENDING,
    newState: ValueGapState.HELD,
    reason: 'PAYMENT_CONFIRMED',
  });
}

// ---------------------------------------------------------------------------
// releaseValueGap — HELD → RELEASED + credit recipient balance
//
// Called when tryCompleteSwap() successfully transitions the swap to COMPLETED.
// Must be called within the same transaction to ensure atomicity:
//   1. ValueGap: HELD → RELEASED (conditional updateMany)
//   2. BalanceEntry: VALUE_GAP_CREDIT (idempotent via unique constraint)
//   3. BalanceAccount: increment availableBalancePence
//
// If anything fails the entire transaction rolls back — ValueGap remains HELD
// and no balance is credited.
//
// Returns: { id, recipientUserId, valueGapPence, currency } on success, or
//          null if no release was performed.
//
// The caller is responsible for notifying the disbursement provider OUTSIDE
// the database transaction (see notifyDisbursementRelease).
//
// Idempotent: if already RELEASED, returns null (no-op). If not HELD, logs
// warning and returns null.
// ---------------------------------------------------------------------------

export interface ReleasedGapInfo {
  id: string;
  recipientUserId: string;
  valueGapPence: number;
  currency: string;
}

export async function releaseValueGap(
  tx: Prisma.TransactionClient,
  swapId: string,
): Promise<ReleasedGapInfo | null> {
  const valueGap = await tx.valueGap.findUnique({
    where: { swapId },
  });

  if (!valueGap) {
    // No value gap — equal-value swap or gap not yet allocated
    return null;
  }

  if (valueGap.state === ValueGapState.RELEASED) {
    // Already released — idempotent no-op
    log.info({ swapId, valueGapId: valueGap.id }, 'ValueGap already RELEASED');
    return null;
  }

  if (valueGap.state !== ValueGapState.HELD) {
    log.warn(
      { swapId, valueGapId: valueGap.id, state: valueGap.state },
      'Cannot release ValueGap: unexpected state',
    );
    return null;
  }

  const now = new Date();

  // Conditionally claim the ValueGap (HELD → RELEASED).
  // updateMany with state=HELD prevents double-release.
  const claimed = await tx.valueGap.updateMany({
    where: { id: valueGap.id, state: ValueGapState.HELD },
    data: {
      state: ValueGapState.RELEASED,
      releasedAt: now,
      releaseReason: 'SWAP_COMPLETED',
    },
  });

  if (claimed.count === 0) {
    // Concurrent transition — another instance won the race
    log.warn({ swapId, valueGapId: valueGap.id }, 'ValueGap RELEASED by concurrent transaction');
    return null;
  }

  // Credit the recipient's balance atomically within the same transaction.
  // If this fails, the entire transaction rolls back — ValueGap stays HELD.
  const credited = await creditValueGap(tx, {
    valueGapId: valueGap.id,
    recipientUserId: valueGap.recipientUserId,
    valueGapPence: valueGap.valueGapPence,
    currency: valueGap.currency,
    swapId,
  });

  if (!credited) {
    // Balance credit already exists — this should not happen if we just
    // transitioned from HELD, but log it for safety.
    log.warn(
      { swapId, valueGapId: valueGap.id, recipientUserId: valueGap.recipientUserId },
      'Balance credit already exists for newly released ValueGap',
    );
  }

  auditLog({
    swapId,
    paymentId: valueGap.paymentId,
    payerUserId: valueGap.payerUserId,
    recipientUserId: valueGap.recipientUserId,
    valueGapPence: valueGap.valueGapPence,
    previousState: ValueGapState.HELD,
    newState: ValueGapState.RELEASED,
    reason: 'SWAP_COMPLETED',
  });

  return {
    id: valueGap.id,
    recipientUserId: valueGap.recipientUserId,
    valueGapPence: valueGap.valueGapPence,
    currency: valueGap.currency,
  };
}

// ---------------------------------------------------------------------------
// notifyDisbursementRelease — notify external payout provider
//
// Call this OUTSIDE any database transaction after releaseValueGap succeeds.
// The disbursement provider is a placeholder and does NOT make real network
// calls. A future real provider must execute outside the Prisma transaction
// (after the DB commit) to avoid long-running transactions and potential
// rollback of committed state.
// ---------------------------------------------------------------------------

export async function notifyDisbursementRelease(gapInfo: ReleasedGapInfo): Promise<void> {
  try {
    const provider = getDisbursementProvider();
    const result = await provider.release({
      valueGapId: gapInfo.id,
      recipientUserId: gapInfo.recipientUserId,
      valueGapPence: gapInfo.valueGapPence,
      currency: gapInfo.currency,
    });
    log.info(
      { valueGapId: gapInfo.id, result },
      'Disbursement provider notified of release',
    );
  } catch (err) {
    // Non-fatal: the value gap is already RELEASED in our ledger.
    // The provider notification is best-effort and retriable.
    log.error({ err, valueGapId: gapInfo.id }, 'Failed to notify disbursement provider');
  }
}

// ---------------------------------------------------------------------------
// refundValueGap — HELD → REFUNDED (or PENDING → REFUNDED)
//
// Called when a swap is cancelled or expires after payment. Transitions the
// value gap to REFUNDED if it is in HELD or PENDING state.
//
// Idempotent: if already REFUNDED or RELEASED, no-op.
// Returns true if the refund was performed, false if skipped.
// ---------------------------------------------------------------------------

export async function refundValueGap(
  tx: Prisma.TransactionClient,
  paymentId: string,
  reason: string,
): Promise<boolean> {
  const valueGap = await tx.valueGap.findUnique({
    where: { paymentId },
  });

  if (!valueGap) {
    // No value gap — equal-value swap
    return true; // not an error
  }

  if (valueGap.state === ValueGapState.REFUNDED) {
    log.info({ paymentId, valueGapId: valueGap.id }, 'ValueGap already REFUNDED');
    return true;
  }

  if (valueGap.state === ValueGapState.RELEASED) {
    // RELEASED → REFUNDED is not allowed — requires dispute/recovery workflow
    log.error(
      { paymentId, valueGapId: valueGap.id, state: valueGap.state },
      'Cannot refund RELEASED ValueGap — requires dispute/recovery workflow',
    );
    return false;
  }

  if (!isValidTransition(valueGap.state, ValueGapState.REFUNDED)) {
    log.warn(
      { paymentId, valueGapId: valueGap.id, state: valueGap.state },
      'Cannot refund ValueGap: unexpected state',
    );
    return false;
  }

  const now = new Date();

  const claimed = await tx.valueGap.updateMany({
    where: { id: valueGap.id, state: valueGap.state },
    data: {
      state: ValueGapState.REFUNDED,
      refundedAt: now,
      refundReason: reason,
    },
  });

  if (claimed.count === 0) {
    log.warn({ paymentId, valueGapId: valueGap.id }, 'ValueGap REFUNDED by concurrent transaction');
    return false;
  }

  auditLog({
    swapId: valueGap.swapId,
    paymentId: valueGap.paymentId,
    payerUserId: valueGap.payerUserId,
    recipientUserId: valueGap.recipientUserId,
    valueGapPence: valueGap.valueGapPence,
    previousState: valueGap.state,
    newState: ValueGapState.REFUNDED,
    reason,
  });

  return true;
}

// ---------------------------------------------------------------------------
// getValueGap — read-only accessor
// ---------------------------------------------------------------------------

export async function getValueGap(swapId: string) {
  return prisma.valueGap.findUnique({
    where: { swapId },
    include: {
      payer: { select: { id: true, name: true } },
      recipient: { select: { id: true, name: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// reconcileValueGaps — sweep for stuck state + detect anomalies
//
// Finds HELD value gaps and either refunds or releases them based on the
// authoritative swap/shipment state. Safe to run from multiple instances
// concurrently — all state transitions use conditional updateMany.
//
// 1. HELD + CANCELLED/EXPIRED swap  → REFUNDED
// 2. HELD + COMPLETED swap + both shipments DELIVERED → RELEASED + credit
//    (retries the release that failed during tryCompleteSwap)
// 3. Anomaly detection:
//    A. ValueGap RELEASED but missing VALUE_GAP_CREDIT balance entry
//    B. ValueGap RELEASED but incorrect credit amount
//    C. Duplicate credit entries
//
// The disbursement provider is notified OUTSIDE the transaction for each
// release, following the same pattern as tryCompleteSwap.
// ---------------------------------------------------------------------------

export async function reconcileValueGaps(): Promise<number> {
  let reconciled = 0;

  // 1. Refund HELD gaps for cancelled/expired swaps
  const stuckHeld = await prisma.valueGap.findMany({
    where: {
      state: ValueGapState.HELD,
      swap: { status: { in: ['CANCELLED', 'EXPIRED'] } },
    },
    select: { id: true, paymentId: true, swapId: true, valueGapPence: true },
  });

  for (const vg of stuckHeld) {
    try {
      await prisma.$transaction(async (tx) => {
        await refundValueGap(tx, vg.paymentId, 'RECONCILIATION_CANCELLED_SWAP');
      });
      reconciled++;
    } catch (err) {
      log.error({ err, valueGapId: vg.id, swapId: vg.swapId }, 'Failed to reconcile stuck ValueGap');
    }
  }

  // 2. Release HELD gaps on COMPLETED swaps where both shipments are DELIVERED
  const releaseableHeld = await prisma.valueGap.findMany({
    where: {
      state: ValueGapState.HELD,
      swap: {
        status: 'COMPLETED',
        shipments: {
          every: { status: ShipmentStatus.DELIVERED },
        },
      },
    },
    select: {
      id: true,
      swapId: true,
      recipientUserId: true,
      valueGapPence: true,
      currency: true,
      swap: {
        select: { _count: { select: { shipments: true } } },
      },
    },
  });

  // Filter to swaps with exactly 2 non-cancelled shipments
  const eligible = releaseableHeld.filter((vg) => vg.swap._count.shipments === 2);

  for (const vg of eligible) {
    try {
      const released = await prisma.$transaction(async (tx) => {
        return releaseValueGap(tx, vg.swapId);
      });
      if (released) {
        await notifyDisbursementRelease(released);
        reconciled++;
      }
    } catch (err) {
      log.error(
        { err, valueGapId: vg.id, swapId: vg.swapId },
        'Failed to release stuck ValueGap for COMPLETED swap',
      );
    }
  }

  // 3. Anomaly detection: RELEASED gaps with missing or incorrect credits
  const releasedGaps = await prisma.valueGap.findMany({
    where: { state: ValueGapState.RELEASED },
    select: {
      id: true,
      swapId: true,
      recipientUserId: true,
      valueGapPence: true,
      balanceEntry: {
        select: { id: true, amountPence: true, userId: true },
      },
    },
  });

  for (const vg of releasedGaps) {
    // A. Missing credit entry
    if (!vg.balanceEntry) {
      log.error(
        { valueGapId: vg.id, swapId: vg.swapId, recipientUserId: vg.recipientUserId },
        'ANOMALY: ValueGap RELEASED but missing VALUE_GAP_CREDIT balance entry',
      );
      continue;
    }

    // B. Incorrect credit amount
    if (vg.balanceEntry.amountPence !== vg.valueGapPence) {
      log.error(
        {
          valueGapId: vg.id,
          swapId: vg.swapId,
          expectedAmount: vg.valueGapPence,
          actualAmount: vg.balanceEntry.amountPence,
        },
        'ANOMALY: ValueGap RELEASED but incorrect credit amount',
      );
    }

    // C. Wrong recipient
    if (vg.balanceEntry.userId !== vg.recipientUserId) {
      log.error(
        {
          valueGapId: vg.id,
          swapId: vg.swapId,
          expectedRecipient: vg.recipientUserId,
          actualRecipient: vg.balanceEntry.userId,
        },
        'ANOMALY: ValueGap RELEASED but credit went to wrong user',
      );
    }
  }

  // 4. Anomaly detection: REFUNDED gaps that have balance credits
  //    (credits should never exist for REFUNDED gaps)
  const refundedWithCredits = await prisma.valueGap.findMany({
    where: { state: ValueGapState.REFUNDED },
    select: {
      id: true,
      swapId: true,
      balanceEntry: {
        select: { id: true, amountPence: true, userId: true },
      },
    },
  });

  for (const vg of refundedWithCredits) {
    if (vg.balanceEntry) {
      log.error(
        {
          valueGapId: vg.id,
          swapId: vg.swapId,
          balanceEntryId: vg.balanceEntry.id,
          amountPence: vg.balanceEntry.amountPence,
          userId: vg.balanceEntry.userId,
        },
        'ANOMALY: ValueGap REFUNDED but has a VALUE_GAP_CREDIT balance entry',
      );
    }
  }

  // 5. Anomaly detection: duplicate BalanceEntry records for the same value gap
  //    (should be impossible due to UNIQUE constraint, but verify as defense-in-depth)
  const duplicateEntries = await prisma.balanceEntry.groupBy({
    by: ['valueGapId'],
    where: { valueGapId: { not: null }, type: 'VALUE_GAP_CREDIT' },
    _count: { id: true },
    having: { id: { _count: { gt: 1 } } },
  });

  for (const dup of duplicateEntries) {
    log.error(
      { valueGapId: dup.valueGapId, count: dup._count.id },
      'ANOMALY: Duplicate VALUE_GAP_CREDIT balance entries for same value gap',
    );
  }

  // 6. Transfer reconciliation: RELEASED gaps missing externalPayoutRef.
  //    This means the value gap was released in the DB but the Stripe transfer
  //    was never created (crash after DB commit but before provider notification).
  //    Notify the disbursement provider to retry the transfer.
  const releasedWithoutTransfer = await prisma.valueGap.findMany({
    where: { state: ValueGapState.RELEASED, externalPayoutRef: null },
    select: {
      id: true,
      swapId: true,
      recipientUserId: true,
      valueGapPence: true,
      currency: true,
    },
  });

  for (const vg of releasedWithoutTransfer) {
    log.info(
      { valueGapId: vg.id, swapId: vg.swapId },
      'Reconciliation: RELEASED ValueGap missing transfer — retrying disbursement',
    );
    await notifyDisbursementRelease({
      id: vg.id,
      recipientUserId: vg.recipientUserId,
      valueGapPence: vg.valueGapPence,
      currency: vg.currency,
    });
  }

  // 7. Missing ValueGap reconciliation: PAID payments with positive value gap
  //    that have no corresponding ValueGap record. This happens when
  //    markPaymentPaid() successfully marks a Payment as PAID but the
  //    allocateValueGap() call fails (crash, transient error). The Payment is
  //    already PAID, so we must create the ValueGap retrospectively.
  //
  //    Invariant: every PAID payment with amountPence > 0 for a swap that is
  //    not yet terminal (CANCELLED/EXPIRED) must have a ValueGap.
  const paidWithoutGap = await prisma.payment.findMany({
    where: {
      status: PaymentStatus.PAID,
      refundedAt: null,
      amountPence: { gt: 0 },
      valueGap: null,
      swap: { status: { notIn: ['CANCELLED', 'EXPIRED'] } },
    },
    select: {
      id: true,
      swapId: true,
      payerUserId: true,
      amountPence: true,
      feePence: true,
      swap: {
        select: {
          offeringUserId: true,
          requestedUserId: true,
          gapPayer: true,
        },
      },
    },
  });

  for (const payment of paidWithoutGap) {
    try {
      await prisma.$transaction(async (tx) => {
        // Idempotent: allocateValueGap checks for existing ValueGap first
        await allocateValueGap(tx, {
          paymentId: payment.id,
          swapId: payment.swapId,
          payerUserId: payment.payerUserId,
          valueGapPence: payment.amountPence,
          serviceFeePence: payment.feePence,
        });
      });
      reconciled++;
      log.info(
        { paymentId: payment.id, swapId: payment.swapId },
        'Reconciliation: created missing ValueGap for PAID payment',
      );
    } catch (err) {
      log.error(
        { err, paymentId: payment.id, swapId: payment.swapId },
        'Failed to create missing ValueGap for PAID payment',
      );
    }
  }

  return reconciled;
}
