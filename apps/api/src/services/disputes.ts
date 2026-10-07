// ---------------------------------------------------------------------------
// Charge dispute handling (R2 — P2 BLOCKER 4)
//
// A Stripe charge dispute is a cardholder review that Stripe adjudicates. It is
// NOT a refund, and Swapify never derives refund state from it.
//
// Before R2 the charge.dispute.created handler wrote
//
//     Payment.refundedAt = now(), Payment.stripeRefundId = dispute.id
//
// which (a) stored a dispute id (dp_...) in a field that may only hold a refund
// id (re_...), (b) permanently suppressed refundSwapPayment() /
// reconcileRefunds() / missing-ValueGap repair, (c) recorded no durable dispute
// state, (d) left an already-issued Stripe transfer unclawed, and (e) produced
// no alert — so the cardholder could remain unpaid while Swapify believed the
// payment was refunded.
//
// R2 lifecycle (durable, CAS-protected):
//
//   created   -> claim Payment.stripeDisputeId (unique) -> outcome OPEN
//                -> if the ValueGap is already RELEASED with an issued
//                   transfer, record a reversal intent and claw back via the
//                   pre-existing reverseTransfer service
//   updated   -> refresh raw Stripe status; reject stale/out-of-order events;
//                a final status latches the outcome
//   closed    -> latch the final outcome exactly once (WON/LOST/PREVENTED/
//                UNKNOWN). No financial action happens here.
//
// Freeze rule (single definition, used by value-gap.ts and stripe.ts):
//   frozen  <=>  stripeDisputeId IS NOT NULL
//                AND disputeOutcome NOT IN (WON, PREVENTED)
// A frozen payment is refused by releaseValueGap(), refundValueGap() and
// refundSwapPayment(), so neither the internal ledger nor a Stripe refund can
// move funds out from under an open dispute.
//
// Source-of-truth boundaries:
//   Stripe owns: the dispute outcome, charge funds, refund objects, reversals
//   Swapify owns: the local projection of those facts + freeze decisions
//   refundedAt / stripeRefundId are written ONLY by refundSwapPayment after
//   stripe.refunds.create() resolves with a Refund object.
// ---------------------------------------------------------------------------

import { prisma, DisputeOutcome, DisputeReversalState, ValueGapState, type Prisma } from '@swapify/db';
import pino from 'pino';

const log = pino({ name: 'stripe-disputes', level: process.env.LOG_LEVEL ?? 'info' });

// Bounded retries. The Stripe idempotency key (transfer-reversal:{valueGapId})
// makes every retry safe: Stripe returns the existing reversal instead of
// minting a second one. The cap exists so a permanent rejection stops cycling
// and surfaces as a manual-resolution item instead of a hot loop.
export const MAX_DISPUTE_REVERSAL_ATTEMPTS = 3;
export const MAX_DISPUTE_OBSERVATION_ATTEMPTS = 5;
export const MAX_DISPUTE_RECONCILE_BATCH = 20;

// ---------------------------------------------------------------------------
// Webhook input
// ---------------------------------------------------------------------------

export type ChargeDisputeEventType =
  | 'charge.dispute.created'
  | 'charge.dispute.updated'
  | 'charge.dispute.closed';

export const DISPUTE_EVENT_TYPES: ChargeDisputeEventType[] = [
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
];

export interface DisputeEventInput {
  type: ChargeDisputeEventType;
  /** Stripe Event.id — durable-capture key, stable across redeliveries. */
  stripeEventId: string;
  /** Stripe Event.created (unix seconds) — ordering key for stale rejection. */
  eventCreated: number | null;
  dispute: {
    id: string;
    paymentIntentId: string | null;
    status: string | null;
    reason: string | null;
  };
}

export type DisputeEventOutcome =
  | 'DEFERRED' // no local payment match yet — replayed by reconcileDisputes()
  | 'DUPLICATE' // already applied — idempotent no-op
  | 'OUT_OF_ORDER' // stale event ignored, newer state preserved
  | 'RECORDED' // dispute newly claimed
  | 'ALREADY_REFUNDED' // dispute recorded; pre-existing refund facts preserved
  | 'UPDATED' // non-final status refreshed
  | 'FINALIZED' // final outcome latched
  | 'MULTIPLE_DISPUTES'; // a different dispute already owns this payment

export interface DisputeEventResult {
  outcome: DisputeEventOutcome;
  /** True when the observation needs no further replay. */
  applied: boolean;
  /** Set when this call claimed the dispute. */
  claimedHere?: boolean;
  reversalState?: DisputeReversalState | null;
}

// ---------------------------------------------------------------------------
// Transfer-reversal seam
//
// Mirrors setDisbursementProvider() in value-gap.ts: production uses the real
// Stripe transfer reversal; tests inject a deterministic stub so no Stripe
// financial call is ever made from the test harness.
// ---------------------------------------------------------------------------

export interface DisputeReversalRequest {
  transferId: string;
  amountPence: number;
  valueGapId: string;
}

export type DisputeTransferReversalFn = (
  params: DisputeReversalRequest,
) => Promise<{ id: string }>;

async function defaultDisputeTransferReversal(
  params: DisputeReversalRequest,
): Promise<{ id: string }> {
  const { reverseTransfer } = await import('./stripe-connect.js');
  const reversal = await reverseTransfer(params);
  return { id: reversal.id };
}

let disputeTransferReversalImpl: DisputeTransferReversalFn = defaultDisputeTransferReversal;

export function setDisputeTransferReversalImpl(fn: DisputeTransferReversalFn | null): void {
  disputeTransferReversalImpl = fn ?? defaultDisputeTransferReversal;
}

// ---------------------------------------------------------------------------
// Freeze predicate — the single definition used by every fund-moving path.
// ---------------------------------------------------------------------------

export function isPaymentDisputeFrozen(payment: {
  stripeDisputeId: string | null;
  disputeOutcome: DisputeOutcome | null;
}): boolean {
  if (!payment.stripeDisputeId) return false;
  return (
    payment.disputeOutcome !== DisputeOutcome.WON &&
    payment.disputeOutcome !== DisputeOutcome.PREVENTED
  );
}

// ---------------------------------------------------------------------------
// Event extraction (route layer stays free of dispute-shape knowledge)
// ---------------------------------------------------------------------------

export function buildDisputeEvent(
  type: ChargeDisputeEventType,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  obj: any,
  eventCreated: number | null,
  stripeEventId: string,
): DisputeEventInput {
  const paymentIntent = obj?.payment_intent;
  const paymentIntentId =
    typeof paymentIntent === 'string'
      ? paymentIntent
      : paymentIntent && typeof paymentIntent === 'object' && typeof paymentIntent.id === 'string'
        ? paymentIntent.id
        : null;

  return {
    type,
    stripeEventId,
    eventCreated,
    dispute: {
      id: String(obj?.id ?? ''),
      paymentIntentId,
      status: typeof obj?.status === 'string' ? obj.status : null,
      reason: typeof obj?.reason === 'string' ? obj.reason : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Stripe dispute status -> final outcome
//
// Only these statuses are terminal. Everything else is still under review.
// warning_closed is terminal but its money impact is ambiguous, so it is
// classified UNKNOWN: the freeze is preserved and operations must review it.
// ---------------------------------------------------------------------------

export function classifyFinalOutcome(status: string | null): DisputeOutcome | null {
  switch (status) {
    case 'won':
      return DisputeOutcome.WON;
    case 'lost':
      return DisputeOutcome.LOST;
    case 'prevented':
      return DisputeOutcome.PREVENTED;
    case 'warning_closed':
      return DisputeOutcome.UNKNOWN;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// handleChargeDisputeWebhook — webhook entry point
//
// Order matters: the event is captured durably FIRST, so a dispute that lands
// before checkout.session.completed has linked the payment_intent is never
// dropped. Only after a successful apply is the observation marked consumed.
// Any thrown error propagates so the route can answer 500 and Stripe retries.
// ---------------------------------------------------------------------------

export async function handleChargeDisputeWebhook(
  input: DisputeEventInput,
): Promise<DisputeEventResult> {
  if (!input.dispute.id) {
    // Cannot key durable state without a dispute id — loud failure, Stripe retries.
    throw new Error('Dispute event is missing dispute.id');
  }

  await captureDisputeEvent(input);

  const result = await processDisputeEvent(input);

  if (result.applied) {
    await prisma.disputeEventObservation.updateMany({
      where: { stripeEventId: input.stripeEventId, consumed: false },
      data: { consumed: true, consumedAt: new Date() },
    });
  }

  return result;
}

async function captureDisputeEvent(input: DisputeEventInput): Promise<void> {
  await prisma.disputeEventObservation.upsert({
    where: { stripeEventId: input.stripeEventId },
    create: {
      stripeEventId: input.stripeEventId,
      stripeDisputeId: input.dispute.id,
      eventType: input.type,
      paymentIntentId: input.dispute.paymentIntentId,
      disputeStatus: input.dispute.status,
      disputeReason: input.dispute.reason,
      eventCreated: input.eventCreated,
    },
    // Never reset consumed/attempts: a redelivery of the same Stripe event
    // must not undo reconciliation progress.
    update: {},
  });
}

// ---------------------------------------------------------------------------
// processDisputeEvent — the pure state machine (also used by reconciliation)
// ---------------------------------------------------------------------------

async function processDisputeEvent(input: DisputeEventInput): Promise<DisputeEventResult> {
  const payment = input.dispute.paymentIntentId
    ? await prisma.payment.findFirst({
        where: { stripePaymentIntentId: input.dispute.paymentIntentId },
        include: { valueGap: true },
      })
    : null;

  if (!payment) {
    log.warn(
      {
        disputeId: input.dispute.id,
        paymentIntentId: input.dispute.paymentIntentId,
        eventType: input.type,
      },
      'DEFERRED: dispute references a payment_intent Swapify has not linked yet — durable capture kept for replay',
    );
    return { outcome: 'DEFERRED', applied: false };
  }

  if (payment.stripeDisputeId && payment.stripeDisputeId !== input.dispute.id) {
    log.error(
      {
        disputeId: input.dispute.id,
        existingDisputeId: payment.stripeDisputeId,
        paymentId: payment.id,
      },
      'ANOMALY: MULTIPLE_DISPUTES — a second dispute claims a payment already owned by another dispute; manual review required',
    );
    return { outcome: 'MULTIPLE_DISPUTES', applied: true };
  }

  let current = payment;
  let claimedHere = false;
  let preExistingRefund = false;

  if (!current.stripeDisputeId) {
    const claim = await claimDispute(current, input);
    claimedHere = claim.claimed;
    preExistingRefund = claim.preExistingRefund;

    const refreshed = await prisma.payment.findUnique({
      where: { id: payment.id },
      include: { valueGap: true },
    });
    if (!refreshed || refreshed.stripeDisputeId !== input.dispute.id) {
      if (claimedHere) {
        // The claim was written and then lost/overwritten — should be
        // impossible (stripeDisputeId is unique). Treat as an anomaly.
        log.error(
          { paymentId: payment.id, disputeId: input.dispute.id },
          'ANOMALY: dispute claim did not survive — manual review required',
        );
      }
      return { outcome: 'DUPLICATE', applied: true };
    }
    current = refreshed;

    // Funds already sent to the connected account? Record the intent and claw
    // back through the pre-existing, idempotent transfer-reversal service.
    // This runs on the claim path only, so a redelivery can never re-attempt it.
    const reversalState = await initiateTransferReversal(current);
    if (reversalState !== undefined) {
      log.warn(
        {
          paymentId: current.id,
          swapId: current.swapId,
          disputeId: input.dispute.id,
          reason: input.dispute.reason,
          status: input.dispute.status,
          reversalState,
        },
        'Charge dispute recorded — payment frozen from release/refund',
      );
      return {
        outcome: preExistingRefund ? 'ALREADY_REFUNDED' : 'RECORDED',
        applied: true,
        claimedHere: true,
        reversalState,
      };
    }

    log.warn(
      {
        paymentId: current.id,
        swapId: current.swapId,
        disputeId: input.dispute.id,
        reason: input.dispute.reason,
        status: input.dispute.status,
      },
      'Charge dispute recorded — payment frozen from release/refund',
    );
    return {
      outcome: preExistingRefund ? 'ALREADY_REFUNDED' : 'RECORDED',
      applied: true,
      claimedHere: true,
      reversalState: null,
    };
  }

  // Dispute already claimed — this delivery is an updated/closed (or a
  // duplicate created).
  if (input.type === 'charge.dispute.created') {
    log.info(
      { paymentId: current.id, disputeId: input.dispute.id },
      'Duplicate charge.dispute.created — idempotent no-op',
    );
    return { outcome: 'DUPLICATE', applied: true };
  }

  const finalOutcome = classifyFinalOutcome(input.dispute.status);

  if (input.type === 'charge.dispute.closed') {
    // A closed event carrying a non-final status is contradictory: latch
    // UNKNOWN (freeze preserved, manual review) rather than guessing.
    const target = finalOutcome ?? DisputeOutcome.UNKNOWN;
    const latched = await applyFinalOutcome(current.id, input, target);
    if (!latched) {
      log.info(
        { paymentId: current.id, disputeId: input.dispute.id, target },
        'Dispute resolution already recorded — idempotent no-op',
      );
      return { outcome: 'DUPLICATE', applied: true };
    }
    log.warn(
      { paymentId: current.id, disputeId: input.dispute.id, finalOutcome: target },
      target === DisputeOutcome.WON || target === DisputeOutcome.PREVENTED
        ? 'Dispute resolved in our favour — payment unfrozen; no refund or release was performed by this handler'
        : 'Dispute closed without funds returning to the platform — payment stays frozen, manual review required',
    );
    return { outcome: 'FINALIZED', applied: true };
  }

  // charge.dispute.updated
  if (claimedHere) {
    return { outcome: 'UPDATED', applied: true, claimedHere };
  }

  if (current.disputeOutcome && current.disputeOutcome !== DisputeOutcome.OPEN) {
    log.info(
      { paymentId: current.id, disputeId: input.dispute.id, outcome: current.disputeOutcome },
      'charge.dispute.updated after a final outcome — idempotent no-op, dispute cannot reopen',
    );
    return { outcome: 'DUPLICATE', applied: true };
  }

  if (finalOutcome) {
    const latched = await applyFinalOutcome(current.id, input, finalOutcome);
    if (!latched) {
      return { outcome: 'DUPLICATE', applied: true };
    }
    log.warn(
      { paymentId: current.id, disputeId: input.dispute.id, finalOutcome },
      'Dispute resolved via charge.dispute.updated — payment stays frozen pending manual review',
    );
    return { outcome: 'FINALIZED', applied: true };
  }

  if (
    input.eventCreated != null &&
    current.disputeEventAt != null &&
    input.eventCreated < current.disputeEventAt
  ) {
    log.warn(
      {
        paymentId: current.id,
        disputeId: input.dispute.id,
        eventCreated: input.eventCreated,
        lastAppliedAt: current.disputeEventAt,
      },
      'charge.dispute.updated is out-of-order/stale — newer dispute state preserved',
    );
    return { outcome: 'OUT_OF_ORDER', applied: true };
  }

  if (
    input.eventCreated != null &&
    current.disputeEventAt === input.eventCreated &&
    current.disputeStatus === input.dispute.status
  ) {
    log.info(
      { paymentId: current.id, disputeId: input.dispute.id },
      'Duplicate charge.dispute.updated — idempotent no-op',
    );
    return { outcome: 'DUPLICATE', applied: true };
  }

  await prisma.payment.update({
    where: { id: current.id },
    data: {
      disputeStatus: input.dispute.status ?? current.disputeStatus,
      disputeReason: input.dispute.reason ?? current.disputeReason,
      ...(input.eventCreated != null ? { disputeEventAt: input.eventCreated } : {}),
    },
  });

  log.info(
    { paymentId: current.id, disputeId: input.dispute.id, status: input.dispute.status },
    'Charge dispute updated — payment remains frozen',
  );
  return { outcome: 'UPDATED', applied: true };
}

// ---------------------------------------------------------------------------
// claimDispute — atomic PENDING claim on Payment.stripeDisputeId (unique)
// ---------------------------------------------------------------------------

async function claimDispute(
  payment: { id: string; refundedAt: Date | null; stripeRefundId: string | null },
  input: DisputeEventInput,
): Promise<{ claimed: boolean; preExistingRefund: boolean }> {
  // A payment that was genuinely refunded (refundSwapPayment created a real
  // Stripe Refund) has its facts preserved exactly: Stripe resolves the
  // dispute against that refund. We only record the dispute for audit.
  const preExistingRefund = Boolean(payment.refundedAt && payment.stripeRefundId);

  const claimed = await prisma.payment.updateMany({
    where: { id: payment.id, stripeDisputeId: null },
    data: {
      stripeDisputeId: input.dispute.id,
      disputeStatus: input.dispute.status,
      disputeReason: input.dispute.reason,
      disputeOutcome: DisputeOutcome.OPEN,
      disputeOpenedAt: new Date(),
      ...(input.eventCreated != null ? { disputeEventAt: input.eventCreated } : {}),
    },
  });

  if (claimed.count === 0) {
    return { claimed: false, preExistingRefund };
  }

  if (preExistingRefund) {
    log.warn(
      { paymentId: payment.id, disputeId: input.dispute.id },
      'Dispute on an already-refunded payment — refund facts preserved untouched, dispute recorded',
    );
  }

  return { claimed: true, preExistingRefund };
}

// ---------------------------------------------------------------------------
// applyFinalOutcome — atomic OPEN -> final latch (terminal)
// ---------------------------------------------------------------------------

async function applyFinalOutcome(
  paymentId: string,
  input: DisputeEventInput,
  finalOutcome: DisputeOutcome,
): Promise<boolean> {
  const where: Prisma.PaymentWhereInput = {
    id: paymentId,
    stripeDisputeId: input.dispute.id,
    AND: [
      { OR: [{ disputeOutcome: null }, { disputeOutcome: DisputeOutcome.OPEN }] },
      ...(input.eventCreated != null
        ? [{ OR: [{ disputeEventAt: null }, { disputeEventAt: { lte: input.eventCreated } }] }]
        : []),
    ],
  };

  const applied = await prisma.payment.updateMany({
    where,
    data: {
      disputeOutcome: finalOutcome,
      disputeStatus: input.dispute.status ?? undefined,
      disputeReason: input.dispute.reason ?? undefined,
      disputeClosedAt: new Date(),
      ...(input.eventCreated != null ? { disputeEventAt: input.eventCreated } : {}),
    },
  });

  return applied.count === 1;
}

// ---------------------------------------------------------------------------
// initiateTransferReversal — claim path only
//
// Returns undefined when no reversal is required (the normal case), otherwise
// the durable reversal state after the attempt.
// ---------------------------------------------------------------------------

async function initiateTransferReversal(
  payment: { id: string; valueGap: { id: string; state: ValueGapState; externalPayoutRef: string | null; disputeReversalState: DisputeReversalState | null } | null },
): Promise<DisputeReversalState | null | undefined> {
  const gap = payment.valueGap;
  if (!gap) return undefined; // equal-value swap — nothing was transferred
  if (gap.state !== ValueGapState.RELEASED) return undefined; // funds not yet moved
  if (gap.disputeReversalState) return gap.disputeReversalState; // already tracked

  if (!gap.externalPayoutRef) {
    // RELEASED with no recorded transfer reference. We cannot prove whether a
    // transfer exists on Stripe, so we refuse to guess and demand operations.
    log.error(
      { paymentId: payment.id, valueGapId: gap.id },
      'ANOMALY: dispute against a RELEASED ValueGap with no externalPayoutRef — transfer state unknown, manual review required',
    );
    return undefined;
  }

  // Record the intent durably BEFORE the network call so a crash between the
  // claim and the reversal is recoverable by reconcileDisputes().
  await prisma.valueGap.updateMany({
    where: { id: gap.id, disputeReversalState: null },
    data: { disputeReversalState: DisputeReversalState.PENDING },
  });

  return attemptTransferReversal(gap.id);
}

// ---------------------------------------------------------------------------
// attemptTransferReversal — one bounded, idempotent clawback attempt
//
// Never fabricates: REVERSED is written only after reverseTransfer resolves.
// Any thrown error (including a timeout with an unknown outcome) is recorded as
// FAILED and retried under the deterministic Stripe idempotency key
// transfer-reversal:{valueGapId}, which cannot mint a second reversal.
// The recipient's internal balance is deliberately NOT touched — clawing that
// back would require inventing a negative-balance mechanism.
// ---------------------------------------------------------------------------

async function attemptTransferReversal(
  valueGapId: string,
): Promise<DisputeReversalState | null> {
  const gap = await prisma.valueGap.findUnique({ where: { id: valueGapId } });
  if (!gap) return null;
  if (gap.disputeReversalState === DisputeReversalState.REVERSED) {
    return DisputeReversalState.REVERSED;
  }
  if (
    gap.disputeReversalState === DisputeReversalState.FAILED &&
    gap.disputeReversalAttempts >= MAX_DISPUTE_REVERSAL_ATTEMPTS
  ) {
    return DisputeReversalState.FAILED;
  }
  if (!gap.externalPayoutRef) return null;

  try {
    const reversal = await disputeTransferReversalImpl({
      transferId: gap.externalPayoutRef,
      amountPence: gap.valueGapPence,
      valueGapId: gap.id,
    });

    await prisma.valueGap.updateMany({
      where: { id: gap.id },
      data: {
        disputeReversalState: DisputeReversalState.REVERSED,
        disputeReversalAttempts: { increment: 1 },
        disputeReversalAt: new Date(),
      },
    });

    log.warn(
      {
        valueGapId: gap.id,
        paymentId: gap.paymentId,
        transferId: gap.externalPayoutRef,
        reversalId: reversal.id,
        amountPence: gap.valueGapPence,
      },
      'Reversed Stripe transfer to claw back value-gap funds after dispute',
    );
    return DisputeReversalState.REVERSED;
  } catch (err) {
    await prisma.valueGap.updateMany({
      where: { id: gap.id },
      data: {
        disputeReversalState: DisputeReversalState.FAILED,
        disputeReversalAttempts: { increment: 1 },
      },
    });

    log.error(
      {
        err,
        valueGapId: gap.id,
        paymentId: gap.paymentId,
        transferId: gap.externalPayoutRef,
        attempts: gap.disputeReversalAttempts + 1,
        maxAttempts: MAX_DISPUTE_REVERSAL_ATTEMPTS,
      },
      'ANOMALY: DISPUTE_REVERSAL_FAILED — transferred funds have NOT been clawed back and the recipient\'s internal balance is unchanged. Manual operational resolution required before payout is considered safe. No refund state was written.',
    );
    return DisputeReversalState.FAILED;
  }
}

// ---------------------------------------------------------------------------
// reconcileDisputes — crash recovery for partial dispute processing
//
// Distinguishes, from durable state alone:
//   1. dispute recorded, no refund requested   stripeDisputeId set,
//                                              refundedAt null, outcome OPEN
//   2. refund request in progress              swap terminal, refundedAt null
//                                              (reconcileRefunds owns this)
//   3. Stripe refund definitely exists         stripeRefundId = re_... 
//   4. Stripe refund definitely does not exist refundedAt null + payment_intent
//                                              linked, no dispute-suppressed
//                                              refund possible while frozen
//   5. Stripe refund result unknown            refundedAt null; retried under
//                                              idempotency key refund-{paymentId}
//   6. refund confirmed locally                refundedAt + stripeRefundId set
//                                              together by one conditional update
//   7. dispute closed                          disputeOutcome latched terminal
//
// Replayed events are bounded (MAX_DISPUTE_OBSERVATION_ATTEMPTS) so an
// unmatched charge cannot spin forever.
// ---------------------------------------------------------------------------

export interface DisputeReconcileResult {
  replayed: number;
  reversals: number;
}

export async function reconcileDisputes(): Promise<DisputeReconcileResult> {
  const result: DisputeReconcileResult = { replayed: 0, reversals: 0 };

  // 1. Replay durable captures that have not been applied yet.
  const pending = await prisma.disputeEventObservation.findMany({
    where: { consumed: false, attempts: { lt: MAX_DISPUTE_OBSERVATION_ATTEMPTS } },
    orderBy: { createdAt: 'asc' },
    take: MAX_DISPUTE_RECONCILE_BATCH,
    select: {
      stripeEventId: true,
      stripeDisputeId: true,
      eventType: true,
      paymentIntentId: true,
      disputeStatus: true,
      disputeReason: true,
      eventCreated: true,
    },
  });

  for (const observation of pending) {
    try {
      const replay = await processDisputeEvent({
        type: observation.eventType as ChargeDisputeEventType,
        stripeEventId: observation.stripeEventId,
        eventCreated: observation.eventCreated,
        dispute: {
          id: observation.stripeDisputeId,
          paymentIntentId: observation.paymentIntentId,
          status: observation.disputeStatus,
          reason: observation.disputeReason,
        },
      });

      if (replay.applied) {
        await prisma.disputeEventObservation.updateMany({
          where: { stripeEventId: observation.stripeEventId, consumed: false },
          data: { consumed: true, consumedAt: new Date() },
        });
        result.replayed++;
      } else {
        await prisma.disputeEventObservation.updateMany({
          where: { stripeEventId: observation.stripeEventId },
          data: { attempts: { increment: 1 } },
        });
      }
    } catch (err) {
      log.error(
        { err, stripeEventId: observation.stripeEventId },
        'Failed to replay captured dispute event',
      );
      await prisma.disputeEventObservation
        .updateMany({
          where: { stripeEventId: observation.stripeEventId },
          data: { attempts: { increment: 1 } },
        })
        .catch(() => undefined);
    }
  }

  // 2. Retry outstanding / failed transfer reversals (idempotency-safe).
  const reversals = await prisma.valueGap.findMany({
    where: {
      OR: [
        { disputeReversalState: DisputeReversalState.PENDING },
        {
          disputeReversalState: DisputeReversalState.FAILED,
          disputeReversalAttempts: { lt: MAX_DISPUTE_REVERSAL_ATTEMPTS },
        },
      ],
    },
    select: { id: true },
    take: MAX_DISPUTE_RECONCILE_BATCH,
  });

  for (const gap of reversals) {
    try {
      const state = await attemptTransferReversal(gap.id);
      if (state === DisputeReversalState.REVERSED) result.reversals++;
    } catch (err) {
      log.error({ err, valueGapId: gap.id }, 'Failed to retry dispute transfer reversal');
    }
  }

  // 3. One-line surfacing of the states that need a human. There is no
  //    dedicated alerting channel in this architecture — these ERROR/WARN logs
  //    are the alert, and they are listed as an observability gap.
  const permanentlyFailed = await prisma.valueGap.count({
    where: {
      disputeReversalState: DisputeReversalState.FAILED,
      disputeReversalAttempts: { gte: MAX_DISPUTE_REVERSAL_ATTEMPTS },
    },
  });
  if (permanentlyFailed > 0) {
    log.error(
      { count: permanentlyFailed },
      'ANOMALY: dispute transfer reversals exhausted all attempts — manual operational resolution required',
    );
  }

  const openDisputes = await prisma.payment.count({
    where: {
      stripeDisputeId: { not: null },
      OR: [{ disputeOutcome: null }, { disputeOutcome: DisputeOutcome.OPEN }],
    },
  });
  if (openDisputes > 0) {
    log.warn({ count: openDisputes }, 'Open charge disputes holding payments in a frozen state');
  }

  return result;
}
