// Phase R1 regression tests — withdrawal payout claim + settlement markers.
//
//   DATABASE_URL=postgresql://swapify:swapify@127.0.0.1:5432/swapify_r335a_baseline \
//     npx tsx qa/r1-withdrawal-recovery.test.mjs
//
// SAFETY: STRIPE_SECRET_KEY is removed before the service module is loaded, so
// stripeEnabled is false and createPayout() throws at its pre-flight guard.
// No Stripe network call, no LIVE credential, no financial object is created.

import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

process.env.DATABASE_URL ||=
  'postgresql://swapify:swapify@127.0.0.1:5432/swapify_r335a_baseline';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_PUBLISHABLE_KEY;

const prisma = new PrismaClient({ log: ['error'] });

const svc = await import('../apps/api/src/services/withdrawal.ts');
const {
  handlePayoutWebhook: payoutWebhook,
  cancelWithdrawal,
  reconcileWithdrawals,
  requestWithdrawal,
  classifyPayoutCreationError,
} = svc;

const AMT = 5000;
const results = [];
const check = (name, fn) => results.push({ name, fn });

let seq = 0;

async function setup({ available = 0, pending = AMT, connected = false } = {}) {
  seq++;
  const tag = `r1-${seq}-${Date.now()}`;
  const user = await prisma.user.create({
    data: { email: `${tag}@test.local`, name: 'R1 Regression' },
  });
  const payoutMethod = await prisma.payoutMethod.create({
    data: {
      userId: user.id,
      type: 'BANK_TRANSFER',
      displayName: 'R1 ****0000',
      last4: '0000',
      bankName: 'R1 Bank',
      isDefault: true,
      isActive: true,
    },
  });
  await prisma.balanceAccount.create({
    data: { userId: user.id, currency: 'GBP', availableBalancePence: available, pendingBalancePence: pending },
  });
  if (connected) {
    await prisma.connectedAccount.create({
      data: { userId: user.id, stripeAccountId: `acct_${tag}`, status: 'ACTIVE', payoutsEnabled: true },
    });
  }
  return { userId: user.id, payoutMethodId: payoutMethod.id, po: `po_${tag}`, tag };
}

async function withdrawal(ctx, data = {}) {
  return prisma.withdrawal.create({
    data: {
      userId: ctx.userId,
      payoutMethodId: ctx.payoutMethodId,
      amountPence: AMT,
      status: 'PROCESSING',
      stripePayoutId: ctx.po,
      idempotencyKey: `r1:${ctx.tag}`,
      processedAt: new Date(),
      ...data,
    },
  });
}

async function account(userId) {
  return prisma.balanceAccount.findUniqueOrThrow({ where: { userId } });
}

async function reversals(userId) {
  return prisma.balanceEntry.findMany({ where: { userId, type: 'WITHDRAWAL_REVERSAL' } });
}

async function cleanup(ctx) {
  await prisma.balanceEntry.deleteMany({ where: { userId: ctx.userId } });
  await prisma.withdrawal.deleteMany({ where: { userId: ctx.userId } });
  await prisma.balanceAccount.deleteMany({ where: { userId: ctx.userId } });
  await prisma.connectedAccount.deleteMany({ where: { userId: ctx.userId } });
  await prisma.payoutMethod.deleteMany({ where: { userId: ctx.userId } });
  await prisma.user.deleteMany({ where: { id: ctx.userId } });
}

// ===========================================================================
// P2 BLOCKER 1 — payout.paid must not strand the reservation
// ===========================================================================

check('B1-1 payout.paid releases the pending reservation exactly once', async () => {
  const ctx = await setup({ available: 0, pending: AMT });
  try {
    const w = await withdrawal(ctx);
    await payoutWebhook({ stripePayoutId: ctx.po, status: 'paid' });

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    const acct = await account(ctx.userId);
    assert.equal(row.status, 'COMPLETED');
    assert.ok(row.settledAt, 'settledAt must prove the release');
    assert.equal(acct.pendingBalancePence, 0, 'reservation released');
    assert.equal(acct.availableBalancePence, 0, 'settlement does not credit available');
    assert.equal((await reversals(ctx.userId)).length, 0, 'settlement is not a reversal');
  } finally {
    await cleanup(ctx);
  }
});

check('B1-2 payout.paid redelivery is a no-op and never releases twice', async () => {
  const ctx = await setup({ available: 0, pending: AMT });
  try {
    await withdrawal(ctx);
    await payoutWebhook({ stripePayoutId: ctx.po, status: 'paid' });
    await payoutWebhook({ stripePayoutId: ctx.po, status: 'paid' });
    await payoutWebhook({ stripePayoutId: ctx.po, status: 'paid' });

    const acct = await account(ctx.userId);
    assert.equal(acct.pendingBalancePence, 0, 'still zero — no second release');
    assert.equal(acct.availableBalancePence, 0);
  } finally {
    await cleanup(ctx);
  }
});

check('B1-3 payout.paid repairs a committed COMPLETED status whose settlement was lost', async () => {
  const ctx = await setup({ available: 0, pending: AMT });
  try {
    // The P2 BLOCKER 1 condition: phase A (status) committed, phase B (balance)
    // did not. settledAt is null because the release never happened.
    const w = await withdrawal(ctx, { status: 'COMPLETED', completedAt: new Date(), settledAt: null });

    await payoutWebhook({ stripePayoutId: ctx.po, status: 'paid' });

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    const acct = await account(ctx.userId);
    assert.ok(row.settledAt, 'redelivery repairs the missing settlement');
    assert.equal(acct.pendingBalancePence, 0, 'reservation released on redelivery');
  } finally {
    await cleanup(ctx);
  }
});

check('B1-4 reconciler repairs COMPLETED with settledAt IS NULL without any webhook', async () => {
  const ctx = await setup({ available: 0, pending: AMT });
  try {
    const w = await withdrawal(ctx, { status: 'COMPLETED', completedAt: new Date(), settledAt: null });

    await reconcileWithdrawals();

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    const acct = await account(ctx.userId);
    assert.ok(row.settledAt, 'reconciliation repaired the missing settlement');
    assert.equal(acct.pendingBalancePence, 0, 'reservation released by reconciliation');

    // Second run must be a no-op.
    await reconcileWithdrawals();
    const acct2 = await account(ctx.userId);
    assert.equal(acct2.pendingBalancePence, 0, 'still zero after a second sweep');
    assert.equal(acct2.availableBalancePence, 0, 'never credited');
  } finally {
    await cleanup(ctx);
  }
});

// ===========================================================================
// P2 BLOCKER 2 — failed/canceled reversal must be atomic and idempotent
// ===========================================================================

check('B2-1 payout.failed returns the reservation in a single transaction', async () => {
  const ctx = await setup({ available: 0, pending: AMT });
  try {
    const w = await withdrawal(ctx);

    await payoutWebhook({ stripePayoutId: ctx.po, status: 'failed' });

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    const acct = await account(ctx.userId);
    assert.equal(row.status, 'FAILED');
    assert.ok(row.reversedAt, 'reversedAt proves the reversal');
    assert.ok(row.settledAt, 'no longer counted by I-P');
    assert.equal(acct.availableBalancePence, AMT, 'funds returned to the user');
    assert.equal(acct.pendingBalancePence, 0, 'reservation released');
    assert.equal((await reversals(ctx.userId)).length, 1, 'exactly one WITHDRAWAL_REVERSAL entry');
  } finally {
    await cleanup(ctx);
  }
});

check('B2-2 a pre-existing WITHDRAWAL_REVERSAL entry cannot skip or duplicate the reversal', async () => {
  const ctx = await setup({ available: 0, pending: AMT });
  try {
    const w = await withdrawal(ctx);
    const acctRow = await account(ctx.userId);
    // P2 I-2: the ledger entry already exists, so the pre-R1 unique index on
    // (referenceType, referenceId) used to abort the whole reversal.
    await prisma.balanceEntry.create({
      data: {
        balanceAccountId: acctRow.id,
        userId: ctx.userId,
        type: 'WITHDRAWAL_REVERSAL',
        amountPence: AMT,
        currency: 'GBP',
        direction: 'CREDIT',
        referenceType: 'WITHDRAWAL_REVERSAL',
        referenceId: w.id,
        description: 'pre-existing reversal entry',
      },
    });

    await payoutWebhook({ stripePayoutId: ctx.po, status: 'failed' });

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    const acct = await account(ctx.userId);
    assert.equal(row.status, 'FAILED');
    assert.ok(row.reversedAt, 'status markers written despite the pre-existing entry');
    assert.equal(acct.availableBalancePence, AMT, 'funds were NOT stranded');
    assert.equal(acct.pendingBalancePence, 0, 'reservation released despite the collision');
    assert.equal((await reversals(ctx.userId)).length, 1, 'no duplicate ledger entry (I-L)');
  } finally {
    await cleanup(ctx);
  }
});

check('B2-3 duplicate payout.failed does not credit twice', async () => {
  const ctx = await setup({ available: 0, pending: AMT });
  try {
    const w = await withdrawal(ctx);
    await payoutWebhook({ stripePayoutId: ctx.po, status: 'failed' });
    await payoutWebhook({ stripePayoutId: ctx.po, status: 'failed' });
    await payoutWebhook({ stripePayoutId: ctx.po, status: 'canceled' });

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    const acct = await account(ctx.userId);
    assert.equal(acct.availableBalancePence, AMT, 'credited exactly once');
    assert.equal(acct.pendingBalancePence, 0);
    assert.equal(row.status, 'FAILED');
    assert.equal((await reversals(ctx.userId)).length, 1, 'exactly one reversal entry');
  } finally {
    await cleanup(ctx);
  }
});

check('B2-4 payout.canceled uses the same single-transaction reversal', async () => {
  const ctx = await setup({ available: 0, pending: AMT });
  try {
    const w = await withdrawal(ctx);
    await payoutWebhook({ stripePayoutId: ctx.po, status: 'canceled' });

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    const acct = await account(ctx.userId);
    // payout.canceled has always mapped to FAILED (see
    // qa/stripe-connect.test.mjs "Canceled should map to FAILED"); R1 keeps
    // that contract and only changes how the reversal is written.
    assert.equal(row.status, 'FAILED');
    assert.ok(row.reversedAt);
    assert.ok(row.settledAt, 'no longer counted by I-P');
    assert.equal(acct.availableBalancePence, AMT);
    assert.equal(acct.pendingBalancePence, 0);
    assert.equal((await reversals(ctx.userId)).length, 1);
    assert.match(row.reversalReason ?? '', /Payout canceled by Stripe/);
  } finally {
    await cleanup(ctx);
  }
});

check('B2-5 reconciler repairs a FAILED withdrawal that has no recorded reversal', async () => {
  const ctx = await setup({ available: 0, pending: AMT });
  try {
    // Pre-R1 failure mode: status committed outside the transaction, so the
    // reversal never happened and reversedAt was never written.
    const w = await withdrawal(ctx, {
      status: 'FAILED',
      failedAt: new Date(),
      reversalReason: 'payout failed by Stripe',
      settledAt: null,
      reversedAt: null,
    });

    await reconcileWithdrawals();

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    const acct = await account(ctx.userId);
    assert.ok(row.reversedAt, 'reconciliation recorded the missing reversal');
    assert.equal(acct.availableBalancePence, AMT, 'funds returned');
    assert.equal(acct.pendingBalancePence, 0, 'reservation released');
    assert.equal((await reversals(ctx.userId)).length, 1, 'exactly one reversal entry');

    await reconcileWithdrawals();
    const acct2 = await account(ctx.userId);
    assert.equal(acct2.availableBalancePence, AMT, 'second sweep does not credit again');
    assert.equal((await reversals(ctx.userId)).length, 1);
  } finally {
    await cleanup(ctx);
  }
});

// ===========================================================================
// P2 BLOCKER 3 — cancel/payout double-spend race
// ===========================================================================

check('B3-1 cancelWithdrawal refuses a claimed PAYOUT_CREATING withdrawal and returns no funds', async () => {
  const ctx = await setup({ available: 0, pending: AMT });
  try {
    const w = await withdrawal(ctx, {
      status: 'PAYOUT_CREATING',
      stripePayoutId: null,
      processedAt: null,
      payoutClaimedAt: new Date(),
      payoutClaimId: `claim:${'pending'}`,
    });

    let caught;
    try {
      await cancelWithdrawal(ctx.userId, w.id);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'cancel must be refused once the payout is claimed');
    assert.equal(caught.code, 'WITHDRAWAL_ALREADY_PROCESSING');

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    const acct = await account(ctx.userId);
    assert.equal(row.status, 'PAYOUT_CREATING', 'claim is not disturbed');
    assert.equal(acct.availableBalancePence, 0, 'NO funds returned');
    assert.equal(acct.pendingBalancePence, AMT, 'reservation still held');
    assert.equal((await reversals(ctx.userId)).length, 0, 'no reversal recorded');
  } finally {
    await cleanup(ctx);
  }
});

check('B3-2 a cancelled withdrawal cannot be re-claimed for payout', async () => {
  const ctx = await setup({ available: 0, pending: AMT });
  try {
    const w = await withdrawal(ctx, { status: 'PENDING', stripePayoutId: null, processedAt: null });

    await cancelWithdrawal(ctx.userId, w.id);

    const afterCancel = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    assert.equal(afterCancel.status, 'CANCELLED');
    assert.ok(afterCancel.reversedAt);
    const acctAfterCancel = await account(ctx.userId);
    assert.equal(acctAfterCancel.availableBalancePence, AMT, 'funds returned by cancel');
    assert.equal(acctAfterCancel.pendingBalancePence, 0);
    assert.equal((await reversals(ctx.userId)).length, 1);

    // Replay the exact durable-claim CAS that requestWithdrawal runs before it
    // ever calls Stripe. Because cancel and claim contend on the same `status`
    // predicate of the same row, this MUST lose.
    const claim = await prisma.withdrawal.updateMany({
      where: { id: w.id, userId: ctx.userId, status: 'PENDING', stripePayoutId: null },
      data: {
        status: 'PAYOUT_CREATING',
        payoutClaimedAt: new Date(),
        payoutClaimId: `claim:${w.id}`,
      },
    });
    assert.equal(claim.count, 0, 'the payout claim cannot win after cancellation');

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    const acct = await account(ctx.userId);
    assert.equal(row.status, 'CANCELLED', 'status untouched — no Stripe call would be made');
    assert.equal(row.stripePayoutId, null);
    assert.equal(acct.availableBalancePence, AMT, 'funds still returned exactly once');
    assert.equal((await reversals(ctx.userId)).length, 1, 'no second reversal');
  } finally {
    await cleanup(ctx);
  }
});

check('B3-3 reconciler never retries a payout beyond the Stripe idempotency window', async () => {
  const ctx = await setup({ available: 0, pending: AMT, connected: true });
  try {
    const stale = new Date(Date.now() - 24 * 60 * 60 * 1000); // > 23h window
    const w = await withdrawal(ctx, {
      status: 'PAYOUT_CREATING',
      stripePayoutId: null,
      processedAt: null,
      payoutClaimedAt: stale,
      payoutClaimId: `claim:${'x'}`,
      createdAt: stale,
    });

    await reconcileWithdrawals();

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    const acct = await account(ctx.userId);
    // A connected account exists, so the only thing standing between the
    // reconciler and createPayout() is the window guard. If the guard failed,
    // Stripe (disabled here) would reject and the row would end up FAILED with
    // the reservation returned — so PAYOUT_CREATING proves no retry was issued.
    assert.equal(row.status, 'PAYOUT_CREATING', 'no second payout attempt was issued');
    assert.equal(row.stripePayoutId, null);
    assert.equal(row.reversedAt, null, 'the unknown outcome is held for manual review');
    assert.equal(acct.pendingBalancePence, AMT, 'reservation still held');
    assert.equal((await reversals(ctx.userId)).length, 0, 'funds are not guessed at');
  } finally {
    await cleanup(ctx);
  }
});

check('B3-4 a fresh claim inside the window IS retried under the original idempotency key', async () => {
  const ctx = await setup({ available: 0, pending: AMT, connected: true });
  try {
    const claimedAt = new Date(Date.now() - 20 * 60 * 1000); // stale, inside 23h
    const w = await withdrawal(ctx, {
      status: 'PAYOUT_CREATING',
      stripePayoutId: null,
      processedAt: null,
      payoutClaimedAt: claimedAt,
      payoutClaimId: `claim:${'y'}`,
      createdAt: claimedAt,
    });

    await reconcileWithdrawals();

    const row = await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
    // Stripe is disabled in this harness, so the boundary reports a definite
    // rejection: nothing reached Stripe and the reservation is returned rather
    // than left stranded in PAYOUT_CREATING.
    assert.equal(row.status, 'FAILED');
    assert.ok(row.reversedAt, 'definite rejection reverses exactly once');
    assert.equal(row.stripePayoutId, null, 'no payout reference invented');
    const acct = await account(ctx.userId);
    assert.equal(acct.availableBalancePence, AMT, 'funds returned');
    assert.equal(acct.pendingBalancePence, 0);
    assert.equal((await reversals(ctx.userId)).length, 1);
  } finally {
    await cleanup(ctx);
  }
});

// ===========================================================================
// Full request path: claim precedes Stripe, and a rejection never strands
// ===========================================================================

check('R1-1 requestWithdrawal claims before Stripe; a definite rejection returns the funds', async () => {
  const ctx = await setup({ available: AMT, pending: 0, connected: true });
  try {
    let caught;
    try {
      await requestWithdrawal({ userId: ctx.userId, amountPence: AMT });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'Stripe is disabled, so the payout cannot be created');
    assert.equal(caught.code, 'WITHDRAWAL_FAILED');

    const rows = await prisma.withdrawal.findMany({ where: { userId: ctx.userId } });
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.status, 'FAILED', 'never left in PAYOUT_CREATING');
    assert.ok(row.payoutClaimedAt, 'the durable claim was taken before Stripe was called');
    assert.ok(row.reversedAt, 'the rejection was reversed');
    assert.equal(row.stripePayoutId, null);

    const acct = await account(ctx.userId);
    assert.equal(acct.availableBalancePence, AMT, 'reservation returned in full');
    assert.equal(acct.pendingBalancePence, 0, 'I-P holds');
    assert.equal((await reversals(ctx.userId)).length, 1, 'exactly one reversal entry');

    const entries = await prisma.balanceEntry.findMany({ where: { userId: ctx.userId } });
    assert.equal(entries.filter((e) => e.type === 'WITHDRAWAL_DEBIT').length, 1, 'exactly one debit');
  } finally {
    await cleanup(ctx);
  }
});

// ===========================================================================
// Error classification: unknown must never be treated as definite
// ===========================================================================

check('R1-2 classifyPayoutCreationError separates definite rejections from unknown outcomes', async () => {
  assert.equal(classifyPayoutCreationError(new Error('Stripe is not configured - cannot create payout')), 'definite-rejection');

  const badRequest = Object.assign(new Error('card_declined'), { statusCode: 402 });
  assert.equal(classifyPayoutCreationError(badRequest), 'definite-rejection');

  const rateLimited = Object.assign(new Error('rate limited'), { statusCode: 429 });
  assert.equal(classifyPayoutCreationError(rateLimited), 'unknown', '429 must be held, never blindly retried');

  const serverError = Object.assign(new Error('boom'), { statusCode: 500 });
  assert.equal(classifyPayoutCreationError(serverError), 'unknown', '5xx must be held');

  const timeout = Object.assign(new Error('socket hang up'), { type: 'system', code: 'ECONNRESET' });
  assert.equal(classifyPayoutCreationError(timeout), 'unknown', 'network faults must be held');

  assert.equal(classifyPayoutCreationError('a string'), 'unknown');
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
console.log(`\n${pass}/${results.length} R1 withdrawal recovery checks passed`);
await prisma.$disconnect();
process.exit(fail ? 1 : 0);
