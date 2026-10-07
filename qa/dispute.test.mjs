// Phase R2 regression tests — charge dispute + refund financial integrity
// (P2 BLOCKER 4).
//
//   DATABASE_URL=postgresql://swapify:swapify@127.0.0.1:5432/swapify_r335a_baseline \
//     npx tsx qa/dispute.test.mjs
//
// SAFETY: STRIPE_SECRET_KEY is removed before any service module is loaded, so
// stripeEnabled is false. The two Stripe financial seams (refund creation and
// transfer reversal) are replaced with deterministic in-process stubs. No
// Stripe network call is made, no LIVE or TEST credential is used, and no
// refund / transfer / payout object is created.
//
// NOTE: because Stripe is stubbed, these tests verify Swapify's state machine
// and its refusal rules. They do NOT verify the real Stripe TEST API lifecycle.

import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

process.env.DATABASE_URL ||=
  'postgresql://swapify:swapify@127.0.0.1:5432/swapify_r335a_baseline';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_PUBLISHABLE_KEY;

const prisma = new PrismaClient({ log: ['error'] });

const disputes = await import('../apps/api/src/services/disputes.ts');
const {
  handleChargeDisputeWebhook,
  reconcileDisputes,
  isPaymentDisputeFrozen,
  setDisputeTransferReversalImpl,
  buildDisputeEvent,
  classifyFinalOutcome,
  MAX_DISPUTE_REVERSAL_ATTEMPTS,
} = disputes;

const stripeSvc = await import('../apps/api/src/services/stripe.ts');
const { refundSwapPayment, setCreateStripeRefundImpl } = stripeSvc;

const { releaseValueGap } = await import('../apps/api/src/services/value-gap.ts');

const results = [];
const check = (name, fn) => results.push({ name, fn });

let seq = 0;
let dpSeq = 0;

const nextDisputeId = () => `dp_r2-${++dpSeq}-${Date.now()}`;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function fixture(
  { gapState = null, externalPayoutRef = null, swapStatus = 'PAID', refunded = false, linkIntent = true } = {},
) {
  seq++;
  const tag = `r2-${seq}-${Date.now()}`;
  const payer = await prisma.user.create({
    data: { email: `payer-${tag}@test.local`, name: 'R2 Payer' },
  });
  const recipient = await prisma.user.create({
    data: { email: `recipient-${tag}@test.local`, name: 'R2 Recipient' },
  });
  const itemA = await prisma.item.create({
    data: {
      ownerId: payer.id,
      title: 'R2 Item A',
      description: 'fixture',
      category: 'ELECTRONICS',
      condition: 'GOOD',
      valuePence: 8000,
    },
  });
  const itemB = await prisma.item.create({
    data: {
      ownerId: recipient.id,
      title: 'R2 Item B',
      description: 'fixture',
      category: 'ELECTRONICS',
      condition: 'GOOD',
      valuePence: 7000,
    },
  });
  const swap = await prisma.swap.create({
    data: {
      offeringUserId: payer.id,
      offeringItemId: itemA.id,
      requestedUserId: recipient.id,
      requestedItemId: itemB.id,
      gapPence: 1000,
      gapPayer: 'OFFERING_USER',
      status: swapStatus,
    },
  });
  const paymentIntentId = linkIntent ? `pi_r2_${tag}` : null;
  const payment = await prisma.payment.create({
    data: {
      swapId: swap.id,
      payerUserId: payer.id,
      amountPence: 1000,
      feePence: 50,
      totalPence: 1050,
      status: 'PAID',
      paidAt: new Date(),
      stripeCheckoutSessionId: `cs_${tag}`,
      stripePaymentIntentId: paymentIntentId,
      ...(refunded ? { refundedAt: new Date(), stripeRefundId: 're_existing_9999' } : {}),
    },
  });
  let gap = null;
  if (gapState) {
    gap = await prisma.valueGap.create({
      data: {
        paymentId: payment.id,
        swapId: swap.id,
        payerUserId: payer.id,
        recipientUserId: recipient.id,
        valueGapPence: 1000,
        serviceFeePence: 50,
        currency: 'GBP',
        state: gapState,
        heldAt: gapState === 'PENDING' ? null : new Date(),
        releasedAt: gapState === 'RELEASED' ? new Date() : null,
        releaseReason: gapState === 'RELEASED' ? 'SWAP_COMPLETED' : null,
        externalPayoutRef,
      },
    });
  }
  return { payer, recipient, itemA, itemB, swap, payment, gap, paymentIntentId, tag };
}

async function teardown(...fixtures) {
  for (const f of fixtures) {
    if (!f) continue;
    const userIds = [f.payer.id, f.recipient.id];
    await prisma.balanceEntry.deleteMany({
      where: { OR: [{ userId: { in: userIds } }, { valueGapId: f.gap?.id ?? '__none__' }] },
    });
    await prisma.balanceAccount.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.disputeEventObservation.deleteMany({ where: { stripeDisputeId: f.payment.stripeDisputeId ?? 'x' } });
    await prisma.valueGap.deleteMany({ where: { paymentId: f.payment.id } });
    await prisma.payment.delete({ where: { id: f.payment.id } });
    await prisma.swap.delete({ where: { id: f.swap.id } });
    await prisma.item.deleteMany({ where: { id: { in: [f.itemA.id, f.itemB.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

async function readPayment(id) {
  return prisma.payment.findUnique({ where: { id } });
}

async function readGap(id) {
  return prisma.valueGap.findUnique({ where: { id } });
}

function disputeCreated(f, { disputeId, eventCreated = 1_000_000, status = 'needs_response', reason = 'fraudulent' } = {}) {
  return handleChargeDisputeWebhook({
    type: 'charge.dispute.created',
    stripeEventId: `evt_${disputeId}_${eventCreated}`,
    eventCreated,
    dispute: {
      id: disputeId,
      paymentIntentId: f.paymentIntentId,
      status,
      reason,
    },
  });
}

async function deleteObservationsFor(disputeId) {
  await prisma.disputeEventObservation.deleteMany({ where: { stripeDisputeId: disputeId } });
}

// ===========================================================================
// 1. charge.dispute.created must not set refundedAt
// ===========================================================================

check('1. charge.dispute.created does NOT set refundedAt', async () => {
  const f = await fixture({ gapState: 'HELD' });
  const disputeId = nextDisputeId();
  const result = await disputeCreated(f, { disputeId });

  const payment = await readPayment(f.payment.id);
  assert.equal(payment.refundedAt, null, 'refundedAt must stay null — no Stripe Refund was created');
  assert.equal(result.outcome, 'RECORDED');
  await deleteObservationsFor(disputeId);
  await teardown(f);
});

check('2. charge.dispute.created does NOT store the dispute id as stripeRefundId', async () => {
  const f = await fixture({ gapState: 'HELD' });
  const disputeId = nextDisputeId();
  await disputeCreated(f, { disputeId });

  const payment = await readPayment(f.payment.id);
  assert.equal(payment.stripeRefundId, null, 'stripeRefundId must stay null');
  assert.notEqual(payment.stripeRefundId, disputeId, 'a dispute id is never a refund id');
  assert.notEqual(payment.stripeRefundId, 're_', 'no refund id was minted');
  await deleteObservationsFor(disputeId);
  await teardown(f);
});

check('3. charge.dispute.created durably records the dispute', async () => {
  const f = await fixture({ gapState: 'HELD' });
  const disputeId = nextDisputeId();
  await disputeCreated(f, { disputeId, status: 'needs_response', reason: 'fraudulent' });

  const payment = await readPayment(f.payment.id);
  assert.equal(payment.stripeDisputeId, disputeId, 'durable dispute identifier');
  assert.equal(payment.disputeOutcome, 'OPEN');
  assert.equal(payment.disputeStatus, 'needs_response');
  assert.equal(payment.disputeReason, 'fraudulent');
  assert.ok(payment.disputeOpenedAt instanceof Date, 'disputeOpenedAt recorded');
  assert.equal(payment.disputeEventAt, 1_000_000, 'event ordering key recorded');

  const observation = await prisma.disputeEventObservation.findFirst({
    where: { stripeDisputeId: disputeId },
  });
  assert.ok(observation, 'the event was captured durably before/while being applied');
  assert.equal(observation.eventType, 'charge.dispute.created');
  assert.equal(observation.consumed, true, 'applied event is marked consumed');

  await deleteObservationsFor(disputeId);
  await teardown(f);
});

// ===========================================================================
// 4-6, 13-14. Refund lifecycle (source of truth = a confirmed Stripe Refund)
// ===========================================================================

check('4. a confirmed Stripe refund sets refundedAt and stripeRefundId', async () => {
  const f = await fixture({ gapState: 'HELD', swapStatus: 'CANCELLED' });
  const calls = [];
  setCreateStripeRefundImpl(async (paymentIntentId, idempotencyKey) => {
    calls.push({ paymentIntentId, idempotencyKey });
    return { id: 're_confirmed_1' };
  });
  try {
    await refundSwapPayment(f.payment.id);
  } finally {
    setCreateStripeRefundImpl(null);
  }

  const payment = await readPayment(f.payment.id);
  assert.ok(payment.refundedAt instanceof Date, 'refundedAt set only after confirmation');
  assert.equal(payment.stripeRefundId, 're_confirmed_1');
  assert.equal(calls.length, 1, 'exactly one refund creation attempt');
  assert.equal(
    calls[0].idempotencyKey,
    `refund-${f.payment.id}`,
    'deterministic Stripe idempotency key is used',
  );
  assert.equal(calls[0].paymentIntentId, f.paymentIntentId);
  await teardown(f);
});

check('5. a refund failure does not fabricate refund state', async () => {
  const f = await fixture({ gapState: 'HELD', swapStatus: 'CANCELLED' });
  setCreateStripeRefundImpl(async () => {
    const err = new Error('Your card was declined.');
    err.type = 'StripeCardError';
    throw err;
  });
  try {
    await refundSwapPayment(f.payment.id);
  } finally {
    setCreateStripeRefundImpl(null);
  }

  const payment = await readPayment(f.payment.id);
  assert.equal(payment.refundedAt, null, 'a refused refund must never be recorded');
  assert.equal(payment.stripeRefundId, null);
  await teardown(f);
});

check('6. a refund timeout/unknown outcome does not fabricate refund state', async () => {
  const f = await fixture({ gapState: 'HELD', swapStatus: 'CANCELLED' });
  setCreateStripeRefundImpl(async () => {
    const err = new Error('Request timed out');
    err.code = 'ETIMEDOUT';
    throw err;
  });
  try {
    await refundSwapPayment(f.payment.id);
  } finally {
    setCreateStripeRefundImpl(null);
  }

  const payment = await readPayment(f.payment.id);
  assert.equal(payment.refundedAt, null, 'unknown outcome must not be treated as a refund');
  assert.equal(payment.stripeRefundId, null);
  await teardown(f);
});

check('13. an already-existing refund is detected rather than duplicated', async () => {
  const f = await fixture({ gapState: 'REFUNDED', swapStatus: 'CANCELLED', refunded: true });
  let refundCalls = 0;
  setCreateStripeRefundImpl(async () => {
    refundCalls++;
    return { id: 're_should_not_happen' };
  });
  const disputeId = nextDisputeId();
  try {
    // Even a dispute arriving on top of a genuine refund must preserve it.
    const result = await disputeCreated(f, { disputeId });
    assert.equal(result.outcome, 'ALREADY_REFUNDED');

    await refundSwapPayment(f.payment.id);
  } finally {
    setCreateStripeRefundImpl(null);
  }

  const payment = await readPayment(f.payment.id);
  assert.equal(refundCalls, 0, 'an existing refund is never re-issued');
  assert.equal(payment.stripeRefundId, 're_existing_9999', 'confirmed refund id preserved');
  assert.ok(payment.refundedAt instanceof Date, 'confirmed refundedAt preserved');
  assert.equal(payment.stripeDisputeId, disputeId, 'the dispute is still recorded durably');
  await deleteObservationsFor(disputeId);
  await teardown(f);
});

check('14. refund reconciliation is idempotent across failure, retry and success', async () => {
  const f = await fixture({ gapState: 'HELD', swapStatus: 'CANCELLED' });
  let attempts = 0;
  setCreateStripeRefundImpl(async () => {
    attempts++;
    if (attempts === 1) throw new Error('socket hang up (unknown outcome)');
    return { id: 're_after_retry' };
  });
  try {
    // Attempt 1: unknown outcome — nothing recorded, payment stays eligible.
    await refundSwapPayment(f.payment.id);
    let payment = await readPayment(f.payment.id);
    assert.equal(payment.refundedAt, null, 'unknown outcome leaves the payment reconcilable');

    // Attempt 2: reconciliation retry under the SAME idempotency key.
    await refundSwapPayment(f.payment.id);
    payment = await readPayment(f.payment.id);
    assert.ok(payment.refundedAt instanceof Date, 'retry confirms the refund');
    assert.equal(payment.stripeRefundId, 're_after_retry');

    // Attempt 3: already confirmed — no further Stripe call.
    await refundSwapPayment(f.payment.id);
    payment = await readPayment(f.payment.id);
    assert.equal(attempts, 2, 'no third Stripe call after confirmation');
    assert.equal(payment.stripeRefundId, 're_after_retry', 'confirmed refund id never overwritten');
  } finally {
    setCreateStripeRefundImpl(null);
  }
  await teardown(f);
});

check('8. repeated webhook delivery does not create duplicate refunds', async () => {
  const f = await fixture({ gapState: 'HELD', swapStatus: 'CANCELLED' });
  let refundCalls = 0;
  setCreateStripeRefundImpl(async () => {
    refundCalls++;
    return { id: 're_only_once' };
  });
  try {
    // Three redeliveries of the same dispute event (same Stripe event id).
    const disputeId = nextDisputeId();
    const event = {
      type: 'charge.dispute.created',
      stripeEventId: `evt_dup_${disputeId}`,
      eventCreated: 1_000_000,
      dispute: { id: disputeId, paymentIntentId: f.paymentIntentId, status: 'needs_response', reason: 'fraudulent' },
    };
    const r1 = await handleChargeDisputeWebhook(event);
    const r2 = await handleChargeDisputeWebhook(event);
    const r3 = await handleChargeDisputeWebhook(event);
    assert.equal(r1.outcome, 'RECORDED');
    assert.equal(r2.outcome, 'DUPLICATE');
    assert.equal(r3.outcome, 'DUPLICATE');
    assert.equal(refundCalls, 0, 'a dispute never triggers a refund');

    // Only one durable capture row exists for that Stripe event id.
    const rows = await prisma.disputeEventObservation.count({
      where: { stripeEventId: `evt_dup_${disputeId}` },
    });
    assert.equal(rows, 1, 'the Stripe event id is a unique durable-capture key');

    await deleteObservationsFor(disputeId);
  } finally {
    setCreateStripeRefundImpl(null);
  }
  const payment = await readPayment(f.payment.id);
  assert.equal(payment.refundedAt, null);
  assert.equal(payment.stripeRefundId, null);
  await teardown(f);
});

// ===========================================================================
// 7. Idempotency of the claim
// ===========================================================================

check('7. repeated charge.dispute.created is idempotent', async () => {
  const f = await fixture({ gapState: 'HELD' });
  const disputeId = nextDisputeId();

  const first = await disputeCreated(f, { disputeId, eventCreated: 1_000_000 });
  const afterFirst = await readPayment(f.payment.id);

  // Redelivery with a different Stripe event id, same dispute id.
  const second = await handleChargeDisputeWebhook({
    type: 'charge.dispute.created',
    stripeEventId: `evt_other_${disputeId}`,
    eventCreated: 1_000_500,
    dispute: { id: disputeId, paymentIntentId: f.paymentIntentId, status: 'needs_response', reason: 'fraudulent' },
  });
  const afterSecond = await readPayment(f.payment.id);

  assert.equal(first.outcome, 'RECORDED');
  assert.equal(second.outcome, 'DUPLICATE', 'the unique claim on stripeDisputeId wins once');
  assert.equal(afterSecond.stripeDisputeId, disputeId);
  assert.equal(
    afterSecond.disputeOpenedAt.getTime(),
    afterFirst.disputeOpenedAt.getTime(),
    'the claim timestamp is never rewritten by a redelivery',
  );
  assert.equal(afterSecond.refundedAt, null);
  assert.equal(afterSecond.stripeRefundId, null);

  await deleteObservationsFor(disputeId);
  await teardown(f);
});

// ===========================================================================
// 9-10. updated / closed
// ===========================================================================

check('9. charge.dispute.updated is handled safely', async () => {
  const f = await fixture({ gapState: 'HELD' });
  const disputeId = nextDisputeId();
  await disputeCreated(f, { disputeId, eventCreated: 1_000_000 });

  // Non-final refresh.
  const updated = await handleChargeDisputeWebhook({
    type: 'charge.dispute.updated',
    stripeEventId: `evt_upd1_${disputeId}`,
    eventCreated: 1_001_000,
    dispute: { id: disputeId, paymentIntentId: f.paymentIntentId, status: 'under_review', reason: 'fraudulent' },
  });
  assert.equal(updated.outcome, 'UPDATED');
  let payment = await readPayment(f.payment.id);
  assert.equal(payment.disputeStatus, 'under_review');
  assert.equal(payment.disputeOutcome, 'OPEN', 'a non-final update never closes the dispute');
  assert.equal(payment.refundedAt, null, 'an update never fabricates a refund');

  // Stale / out-of-order refresh must not clobber newer state.
  const stale = await handleChargeDisputeWebhook({
    type: 'charge.dispute.updated',
    stripeEventId: `evt_upd2_${disputeId}`,
    eventCreated: 999_000,
    dispute: { id: disputeId, paymentIntentId: f.paymentIntentId, status: 'needs_response', reason: 'fraudulent' },
  });
  assert.equal(stale.outcome, 'OUT_OF_ORDER');
  payment = await readPayment(f.payment.id);
  assert.equal(payment.disputeStatus, 'under_review', 'newer dispute state preserved');

  // Exact duplicate refresh.
  const dup = await handleChargeDisputeWebhook({
    type: 'charge.dispute.updated',
    stripeEventId: `evt_upd3_${disputeId}`,
    eventCreated: 1_001_000,
    dispute: { id: disputeId, paymentIntentId: f.paymentIntentId, status: 'under_review', reason: 'fraudulent' },
  });
  assert.equal(dup.outcome, 'DUPLICATE');

  // A second dispute on the same payment is refused.
  const otherDisputeId = nextDisputeId();
  const second = await handleChargeDisputeWebhook({
    type: 'charge.dispute.updated',
    stripeEventId: `evt_upd4_${disputeId}`,
    eventCreated: 1_002_000,
    dispute: { id: otherDisputeId, paymentIntentId: f.paymentIntentId, status: 'under_review', reason: 'fraudulent' },
  });
  assert.equal(second.outcome, 'MULTIPLE_DISPUTES');

  await deleteObservationsFor(disputeId);
  await teardown(f);
});

check('10. charge.dispute.closed is handled safely', async () => {
  const f = await fixture({ gapState: 'HELD' });
  const disputeId = nextDisputeId();
  await disputeCreated(f, { disputeId, eventCreated: 1_000_000 });

  const closed = await handleChargeDisputeWebhook({
    type: 'charge.dispute.closed',
    stripeEventId: `evt_closed_${disputeId}`,
    eventCreated: 1_002_000,
    dispute: { id: disputeId, paymentIntentId: f.paymentIntentId, status: 'lost', reason: 'fraudulent' },
  });
  assert.equal(closed.outcome, 'FINALIZED');

  let payment = await readPayment(f.payment.id);
  assert.equal(payment.disputeOutcome, 'LOST');
  assert.ok(payment.disputeClosedAt instanceof Date);
  assert.equal(payment.refundedAt, null, 'closing a dispute never fabricates a refund');
  assert.equal(payment.stripeRefundId, null);

  // Terminal: nothing can reopen it and no further action is taken.
  const reopen = await handleChargeDisputeWebhook({
    type: 'charge.dispute.closed',
    stripeEventId: `evt_closed2_${disputeId}`,
    eventCreated: 1_003_000,
    dispute: { id: disputeId, paymentIntentId: f.paymentIntentId, status: 'won', reason: 'fraudulent' },
  });
  assert.equal(reopen.outcome, 'DUPLICATE', 'a final outcome is a terminal latch');
  payment = await readPayment(f.payment.id);
  assert.equal(payment.disputeOutcome, 'LOST', 'outcome is never overwritten');

  // The gap is untouched by the dispute lifecycle itself.
  const gap = await readGap(f.gap.id);
  assert.equal(gap.state, 'HELD', 'closed does not move the value-gap ledger');
  assert.equal(gap.disputeReversalState, null, 'no reversal is required for a HELD gap');

  await deleteObservationsFor(disputeId);
  await teardown(f);
});

check('10b. an unparseable closed status latches UNKNOWN and stays frozen', async () => {
  const f = await fixture({ gapState: 'HELD' });
  const disputeId = nextDisputeId();
  await disputeCreated(f, { disputeId, eventCreated: 1_000_000 });

  await handleChargeDisputeWebhook({
    type: 'charge.dispute.closed',
    stripeEventId: `evt_closedx_${disputeId}`,
    eventCreated: 1_002_000,
    dispute: { id: disputeId, paymentIntentId: f.paymentIntentId, status: 'warning_closed', reason: null },
  });

  const payment = await readPayment(f.payment.id);
  assert.equal(payment.disputeOutcome, 'UNKNOWN');
  assert.equal(
    isPaymentDisputeFrozen(payment),
    true,
    'UNKNOWN keeps the freeze so the money stays under review',
  );
  await deleteObservationsFor(disputeId);
  await teardown(f);
});

// ===========================================================================
// 11. Out-of-order webhook vs local state
// ===========================================================================

check('11. a dispute arriving before the payment_intent link is recoverable', async () => {
  const f = await fixture({ gapState: 'HELD', linkIntent: false });
  const disputeId = nextDisputeId();

  // checkout.session.completed has not been processed yet, so no Payment row
  // matches this payment_intent.
  const deferred = await handleChargeDisputeWebhook({
    type: 'charge.dispute.created',
    stripeEventId: `evt_deferred_${disputeId}`,
    eventCreated: 1_000_000,
    dispute: { id: disputeId, paymentIntentId: `pi_not_linked_${disputeId}`, status: 'needs_response', reason: 'fraudulent' },
  });
  assert.equal(deferred.outcome, 'DEFERRED');
  assert.equal(deferred.applied, false, 'the event is NOT marked consumed');

  const observation = await prisma.disputeEventObservation.findFirst({
    where: { stripeEventId: `evt_deferred_${disputeId}` },
  });
  assert.ok(observation, 'the event is captured durably');
  assert.equal(observation.consumed, false);

  // checkout.session.completed arrives and links the payment_intent.
  await prisma.payment.update({
    where: { id: f.payment.id },
    data: { stripePaymentIntentId: `pi_not_linked_${disputeId}` },
  });
  f.paymentIntentId = `pi_not_linked_${disputeId}`;

  const reconciled = await reconcileDisputes();
  assert.ok(reconciled.replayed >= 1, 'the captured event was replayed');

  const payment = await readPayment(f.payment.id);
  assert.equal(payment.stripeDisputeId, disputeId, 'the dispute is applied once the payment is linkable');
  assert.equal(payment.refundedAt, null);

  const after = await prisma.disputeEventObservation.findFirst({
    where: { stripeEventId: `evt_deferred_${disputeId}` },
  });
  assert.equal(after.consumed, true, 'replay marks the capture consumed');

  await deleteObservationsFor(disputeId);
  await teardown(f);
});

// ===========================================================================
// 12 + reversal policy. Dispute after the ValueGap has been RELEASED.
// ===========================================================================

check('12. a dispute after a RELEASED ValueGap follows the documented reversal policy', async () => {
  const f = await fixture({ gapState: 'RELEASED', externalPayoutRef: 'tr_r2_test_1' });
  const reversalCalls = [];
  setDisputeTransferReversalImpl(async (params) => {
    reversalCalls.push(params);
    return { id: `trr_${reversalCalls.length}` };
  });

  const disputeId = nextDisputeId();
  try {
    const result = await disputeCreated(f, { disputeId });
    assert.equal(result.outcome, 'RECORDED');

    // Exactly one clawback, through the existing service's contract.
    assert.equal(reversalCalls.length, 1, 'the reversal is attempted once on the atomic claim');
    assert.deepEqual(reversalCalls[0], {
      transferId: 'tr_r2_test_1',
      amountPence: 1000,
      valueGapId: f.gap.id,
    });

    const gap = await readGap(f.gap.id);
    assert.equal(gap.disputeReversalState, 'REVERSED');
    assert.equal(gap.disputeReversalAttempts, 1);
    assert.ok(gap.disputeReversalAt instanceof Date);
    assert.equal(
      gap.releaseReason,
      'SWAP_COMPLETED',
      'the original release reason is preserved (not overwritten by a dispute flag)',
    );
    assert.equal(gap.state, 'RELEASED', 'the ValueGap state machine is not rewritten by a dispute');

    // Redelivery must not claw back twice.
    await handleChargeDisputeWebhook({
      type: 'charge.dispute.created',
      stripeEventId: `evt_redel_${disputeId}`,
      eventCreated: 1_000_500,
      dispute: { id: disputeId, paymentIntentId: f.paymentIntentId, status: 'needs_response', reason: 'fraudulent' },
    });
    assert.equal(reversalCalls.length, 1, 'a redelivery never repeats the reversal');

    // No refund state and no internal-balance clawback were fabricated.
    const payment = await readPayment(f.payment.id);
    assert.equal(payment.refundedAt, null, 'a dispute never fabricates a refund');
    assert.equal(payment.stripeRefundId, null);

    const entries = await prisma.balanceEntry.findMany({ where: { userId: f.recipient.id } });
    const debits = entries.filter((e) => e.direction === 'DEBIT');
    assert.equal(debits.length, 0, 'the recipient internal balance is never auto-debited');

    // Reconciliation reports the reversal as already satisfied.
    const again = await reconcileDisputes();
    assert.equal(again.reversals, 0, 'a REVERSED gap is not selected for retry');
  } finally {
    setDisputeTransferReversalImpl(null);
  }

  await deleteObservationsFor(disputeId);
  await teardown(f);
});

check('12b. a failed transfer reversal is recorded, retried and bounded — never fabricated', async () => {
  const f = await fixture({ gapState: 'RELEASED', externalPayoutRef: 'tr_r2_test_2' });
  let calls = 0;
  setDisputeTransferReversalImpl(async () => {
    calls++;
    throw new Error('Stripe is not configured — cannot reverse transfer');
  });

  const disputeId = nextDisputeId();
  try {
    await disputeCreated(f, { disputeId });

    let gap = await readGap(f.gap.id);
    assert.equal(gap.disputeReversalState, 'FAILED', 'an error is never recorded as REVERSED');
    assert.equal(gap.disputeReversalAttempts, 1);
    assert.equal(gap.disputeReversalAt, null, 'no success timestamp without a success');
    assert.equal(gap.releaseReason, 'SWAP_COMPLETED', 'release reason untouched');

    // Bounded, idempotency-keyed retries.
    await reconcileDisputes();
    gap = await readGap(f.gap.id);
    assert.equal(gap.disputeReversalAttempts, 2);

    await reconcileDisputes();
    gap = await readGap(f.gap.id);
    assert.equal(gap.disputeReversalAttempts, MAX_DISPUTE_REVERSAL_ATTEMPTS);

    // Exhausted: it stops cycling instead of hot-looping.
    await reconcileDisputes();
    gap = await readGap(f.gap.id);
    assert.equal(
      gap.disputeReversalAttempts,
      MAX_DISPUTE_REVERSAL_ATTEMPTS,
      'retries are bounded',
    );
    assert.equal(calls, MAX_DISPUTE_REVERSAL_ATTEMPTS, 'no call beyond the attempt cap');

    // Throughout: no refund state and no balance movement.
    const payment = await readPayment(f.payment.id);
    assert.equal(payment.refundedAt, null);
    assert.equal(payment.stripeRefundId, null);
    const entries = await prisma.balanceEntry.findMany({ where: { userId: f.recipient.id } });
    assert.equal(entries.length, 0, 'a failed reversal never touches the ledger');
  } finally {
    setDisputeTransferReversalImpl(null);
  }

  await deleteObservationsFor(disputeId);
  await teardown(f);
});

check('12c. a RELEASED gap with no transfer reference is flagged, not guessed at', async () => {
  const f = await fixture({ gapState: 'RELEASED', externalPayoutRef: null });
  let calls = 0;
  setDisputeTransferReversalImpl(async () => {
    calls++;
    return { id: 'trr_should_not_exist' };
  });
  const disputeId = nextDisputeId();
  try {
    const result = await disputeCreated(f, { disputeId });
    assert.equal(result.outcome, 'RECORDED');
    assert.equal(calls, 0, 'no reversal is attempted when the transfer reference is unknown');

    const gap = await readGap(f.gap.id);
    assert.equal(gap.disputeReversalState, null, 'state stays unclaimed so operations must review it');
    assert.equal(gap.releaseReason, 'SWAP_COMPLETED');
  } finally {
    setDisputeTransferReversalImpl(null);
  }
  await deleteObservationsFor(disputeId);
  await teardown(f);
});

// ===========================================================================
// 15. Existing refund / value-gap / balance invariants remain intact
// ===========================================================================

check('15. the freeze predicate is exact (only WON/PREVENTED unfreeze)', () => {
  assert.equal(isPaymentDisputeFrozen({ stripeDisputeId: null, disputeOutcome: null }), false);
  assert.equal(
    isPaymentDisputeFrozen({ stripeDisputeId: 'dp_1', disputeOutcome: 'OPEN' }),
    true,
  );
  assert.equal(
    isPaymentDisputeFrozen({ stripeDisputeId: 'dp_1', disputeOutcome: null }),
    true,
    'a claim with no outcome yet is frozen',
  );
  assert.equal(isPaymentDisputeFrozen({ stripeDisputeId: 'dp_1', disputeOutcome: 'LOST' }), true);
  assert.equal(
    isPaymentDisputeFrozen({ stripeDisputeId: 'dp_1', disputeOutcome: 'UNKNOWN' }),
    true,
  );
  assert.equal(
    isPaymentDisputeFrozen({ stripeDisputeId: 'dp_1', disputeOutcome: 'WON' }),
    false,
    'funds returned to the platform — flows resume',
  );
  assert.equal(
    isPaymentDisputeFrozen({ stripeDisputeId: 'dp_1', disputeOutcome: 'PREVENTED' }),
    false,
    'no chargeback occurred — flows resume',
  );
  assert.equal(classifyFinalOutcome('won'), 'WON');
  assert.equal(classifyFinalOutcome('lost'), 'LOST');
  assert.equal(classifyFinalOutcome('prevented'), 'PREVENTED');
  assert.equal(classifyFinalOutcome('warning_closed'), 'UNKNOWN');
  assert.equal(classifyFinalOutcome('under_review'), null);
  assert.equal(classifyFinalOutcome('needs_response'), null);
});

check('15b. releaseValueGap refuses a frozen payment and moves no balance', async () => {
  const f = await fixture({ gapState: 'HELD' });
  const disputeId = nextDisputeId();
  await disputeCreated(f, { disputeId });

  const released = await prisma.$transaction((tx) => releaseValueGap(tx, f.swap.id));
  assert.equal(released, null, 'release is refused while the dispute is open');

  const gap = await readGap(f.gap.id);
  assert.equal(gap.state, 'HELD', 'the ledger stays HELD — no credit was claimed');

  const entries = await prisma.balanceEntry.findMany({ where: { userId: f.recipient.id } });
  assert.equal(entries.length, 0, 'no VALUE_GAP_CREDIT entry was written');

  const account = await prisma.balanceAccount.findUnique({ where: { userId: f.recipient.id } });
  assert.equal(account?.availableBalancePence ?? 0, 0, 'available balance unchanged');

  // The gap is still reconcilable once the dispute resolves (WON unfreezes).
  await prisma.payment.update({
    where: { id: f.payment.id },
    data: { disputeOutcome: 'WON' },
  });
  const afterWon = await prisma.$transaction((tx) => releaseValueGap(tx, f.swap.id));
  assert.ok(afterWon, 'release succeeds once the dispute is resolved in our favour');
  const credited = await prisma.balanceEntry.findMany({ where: { userId: f.recipient.id } });
  assert.equal(credited.length, 1, 'exactly one credit — no duplicate ledger entry');

  await deleteObservationsFor(disputeId);
  await teardown(f);
});

check('15c. refundSwapPayment refuses a frozen payment and writes nothing', async () => {
  const f = await fixture({ gapState: 'HELD', swapStatus: 'CANCELLED' });
  const disputeId = nextDisputeId();
  await disputeCreated(f, { disputeId });

  let refundCalls = 0;
  setCreateStripeRefundImpl(async () => {
    refundCalls++;
    return { id: 're_must_not_happen' };
  });
  try {
    await refundSwapPayment(f.payment.id);
  } finally {
    setCreateStripeRefundImpl(null);
  }

  assert.equal(refundCalls, 0, 'no Stripe refund is attempted on a frozen payment');
  const payment = await readPayment(f.payment.id);
  assert.equal(payment.refundedAt, null);
  assert.equal(payment.stripeRefundId, null);
  const gap = await readGap(f.gap.id);
  assert.equal(gap.state, 'HELD', 'the value-gap ledger is not marked REFUNDED');
  assert.equal(gap.refundedAt, null);

  await deleteObservationsFor(disputeId);
  await teardown(f);
});

check('15d. dispute extraction handles both payment_intent shapes and absences', () => {
  const asString = buildDisputeEvent(
    'charge.dispute.created',
    { id: 'dp_x', payment_intent: 'pi_123', status: 'needs_response', reason: 'fraudulent' },
    1_000_000,
    'evt_1',
  );
  assert.equal(asString.dispute.paymentIntentId, 'pi_123');
  assert.equal(asString.dispute.id, 'dp_x');

  const asObject = buildDisputeEvent(
    'charge.dispute.created',
    { id: 'dp_y', payment_intent: { id: 'pi_456' }, status: 'lost', reason: null },
    null,
    'evt_2',
  );
  assert.equal(asObject.dispute.paymentIntentId, 'pi_456');
  assert.equal(asObject.eventCreated, null);

  const missing = buildDisputeEvent('charge.dispute.created', { id: 'dp_z' }, null, 'evt_3');
  assert.equal(missing.dispute.paymentIntentId, null, 'an absent payment_intent is surfaced, not invented');
  assert.equal(missing.dispute.status, null);
});

check('15e. no code path writes a dispute id into stripeRefundId', async () => {
  // Static source audit: refundedAt / stripeRefundId may only be written by
  // refundSwapPayment, and only from a confirmed Stripe Refund object.
  const { readFileSync, readdirSync } = await import('node:fs');
  const { join, relative } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const root = fileURLToPath(new URL('../apps/api/src/', import.meta.url));
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) {
        const relFile = relative(root, full).replaceAll('\\', '/');
        const lines = readFileSync(full, 'utf8').split('\n');
        lines.forEach((line, i) => {
          for (const m of line.matchAll(/\b(refundedAt|stripeRefundId)\s*:\s*([^,}]+)/g)) {
            const field = m[1];
            const value = m[2].trim();
            // Projections (`: true/false`), where-filters (`: null`) and type
            // annotations (`: Date | null`) are not writes.
            if (value === 'true' || value === 'false' || value === 'null') continue;
            if (/\b(Date|string|number|boolean)\b/.test(value)) continue;

            let isWrite = /\bdata\s*:\s*\{/.test(line.slice(0, m.index));
            let model = null;
            if (!isWrite) {
              for (let j = i - 1; j >= 0 && i - j <= 25; j--) {
                const anchor = lines[j].match(/^\s*(where|select|include|data)\s*:/);
                if (anchor) {
                  isWrite = anchor[1] === 'data';
                  break;
                }
              }
            }
            if (!isWrite) continue;

            // Which model is being written? Walk back to the Prisma call.
            for (let j = i; j >= 0 && i - j <= 40; j--) {
              const call = lines[j].match(/\b(?:tx|prisma)\.(\w+)\.(?:updateMany|update|create|upsert)\s*\(/);
              if (call) {
                model = call[1];
                break;
              }
            }

            // Only Payment.refundedAt / Payment.stripeRefundId are the
            // financial refund facts. ValueGap.refundedAt is a separate
            // ledger column and is allowed.
            const isPaymentFact = field === 'stripeRefundId' || model === 'payment';
            if (!isPaymentFact) continue;

            offenders.push({ file: relFile, line: i + 1, text: line.trim() });
          }
        });
      }
    }
  };
  walk(root);

  for (const o of offenders) {
    assert.ok(
      /services\/stripe\.ts/.test(o.file),
      `refundedAt/stripeRefundId may only be written in services/stripe.ts, found ${o.file}:${o.line}`,
    );
    assert.ok(
      /dispute/.test(o.text) === false || /stripeDisputeId/.test(o.text) === false,
      `a dispute must never appear in a refund write at ${o.file}:${o.line}`,
    );
  }
  assert.ok(
    offenders.length > 0,
    'expected at least the refundSwapPayment write to be found (guards against a broken audit)',
  );
  const routeText = readFileSync(new URL('../apps/api/src/routes/stripe.ts', import.meta.url), 'utf8');
  assert.ok(
    !/stripeRefundId\s*:/.test(routeText),
    'routes/stripe.ts no longer writes stripeRefundId — the P2 defect is gone',
  );
  assert.ok(
    !/refundedAt\s*:/.test(routeText),
    'routes/stripe.ts no longer writes refundedAt — the P2 defect is gone',
  );
});

// ===========================================================================
// Run
// ===========================================================================

let pass = 0;
let fail = 0;
for (const r of results) {
  try {
    await r.fn();
    console.log(`  PASS  ${r.name}`);
    pass++;
  } catch (e) {
    console.error(`  FAIL  ${r.name}`);
    console.error(`        ${e.message}`);
    fail++;
  }
}
console.log(`\n${pass}/${results.length} R2 dispute/refund checks passed`);
await prisma.$disconnect();
process.exit(fail ? 1 : 0);
