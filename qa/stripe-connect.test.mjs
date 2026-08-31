// Stripe Connect Phase B QA tests. Run with: npx tsx qa/stripe-connect.test.mjs
//
// Tests Stripe Connect: connected-account, balance entry constraints,
// withdrawal lifecycle, and ValueGap state transitions.
// Mocks ONLY Stripe API boundary - all DB behavior is real Prisma.

import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['error'] });

const results = [];
function check(name, fn) { results.push({ name, fn }); }

let testCounter = 0;

async function createUser(name) {
  testCounter++;
  return prisma.user.create({
    data: {
      email: `${name.toLowerCase()}-${Date.now()}-${testCounter}@test.local`,
      name,
    },
  });
}

async function createBalanceAccount(userId, availablePence = 0) {
  return prisma.balanceAccount.create({
    data: { userId, currency: 'GBP', availableBalancePence: availablePence, pendingBalancePence: 0 },
  });
}

async function createConnectedAccount(userId, stripeAccountId, status = 'ACTIVE') {
  return prisma.connectedAccount.create({
    data: {
      userId,
      stripeAccountId: stripeAccountId || `acct_test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      status,
      chargesEnabled: status === 'ACTIVE',
      payoutsEnabled: status === 'ACTIVE',
    },
  });
}

async function createPayoutMethod(userId, overrides = {}) {
  return prisma.payoutMethod.create({
    data: {
      userId,
      type: 'BANK_TRANSFER',
      displayName: 'HSBC ****1234',
      last4: '1234',
      bankName: 'HSBC UK',
      isDefault: true,
      isActive: true,
      ...overrides,
    },
  });
}

async function cleanupUser(userId) {
  await prisma.withdrawal.deleteMany({ where: { userId } });
  await prisma.payoutMethod.deleteMany({ where: { userId } });
  await prisma.connectedAccount.deleteMany({ where: { userId } });
  await prisma.balanceEntry.deleteMany({ where: { userId } });
  await prisma.balanceAccount.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
}

// ---------------------------------------------------------------------------
// ConnectedAccount DB tests
// ---------------------------------------------------------------------------

check('ConnectedAccount enforces unique userId', async () => {
  const user = await createUser('ca-1');
  try {
    await createConnectedAccount(user.id, 'acct_ca1');
    let threw = false;
    try {
      await createConnectedAccount(user.id, 'acct_ca1_dup');
    } catch { threw = true; }
    assert.ok(threw, 'Should throw on duplicate userId');
  } finally {
    await cleanupUser(user.id);
  }
});

check('ConnectedAccount enforces unique stripeAccountId', async () => {
  const u1 = await createUser('ca-2a');
  const u2 = await createUser('ca-2b');
  try {
    await createConnectedAccount(u1.id, 'acct_shared');
    let threw = false;
    try {
      await createConnectedAccount(u2.id, 'acct_shared');
    } catch { threw = true; }
    assert.ok(threw, 'Should throw on duplicate stripeAccountId');
  } finally {
    await cleanupUser(u1.id);
    await cleanupUser(u2.id);
  }
});

check('ConnectedAccount stores requirementsDue', async () => {
  const user = await createUser('ca-3');
  try {
    const ca = await createConnectedAccount(user.id, 'acct_ca3', 'RESTRICTED');
    await prisma.connectedAccount.update({
      where: { id: ca.id },
      data: { requirementsDue: ['individual.verification.document'] },
    });
    const updated = await prisma.connectedAccount.findUnique({ where: { id: ca.id } });
    assert.deepEqual(updated.requirementsDue, ['individual.verification.document']);
  } finally {
    await cleanupUser(user.id);
  }
});

check('ConnectedAccount cascade delete with User', async () => {
  const user = await createUser('ca-4');
  await createConnectedAccount(user.id, `acct_cascade_${Date.now()}`);
  await prisma.user.delete({ where: { id: user.id } });
  const count = await prisma.connectedAccount.count({ where: { userId: user.id } });
  assert.equal(count, 0);
});

// ---------------------------------------------------------------------------
// BalanceEntry reversal fix tests
// ---------------------------------------------------------------------------

check('WITHDRAWAL_DEBIT and WITHDRAWAL_REVERSAL entries coexist', async () => {
  const user = await createUser('be-1');
  const account = await createBalanceAccount(user.id, 5000);
  const pm = await createPayoutMethod(user.id);
  const ca = await createConnectedAccount(user.id, 'acct_be1');
  try {
    const withdrawal = await prisma.withdrawal.create({
      data: {
        userId: user.id,
        payoutMethodId: pm.id,
        amountPence: 1000,
        status: 'PENDING',
        idempotencyKey: 'test-be1-key',
      },
    });

    await prisma.balanceEntry.create({
      data: {
        balanceAccountId: account.id,
        userId: user.id,
        type: 'WITHDRAWAL_DEBIT',
        amountPence: 1000,
        currency: 'GBP',
        direction: 'DEBIT',
        referenceType: 'WITHDRAWAL_DEBIT',
        referenceId: withdrawal.id,
        description: 'Withdrawal requested',
      },
    });

    await prisma.balanceEntry.create({
      data: {
        balanceAccountId: account.id,
        userId: user.id,
        type: 'WITHDRAWAL_REVERSAL',
        amountPence: 1000,
        currency: 'GBP',
        direction: 'CREDIT',
        referenceType: 'WITHDRAWAL_REVERSAL',
        referenceId: withdrawal.id,
        description: 'Withdrawal reversed',
      },
    });

    const entries = await prisma.balanceEntry.findMany({ where: { userId: user.id } });
    assert.equal(entries.length, 2);
  } finally {
    await cleanupUser(user.id);
  }
});

check('Old WITHDRAWAL referenceType would collide (regression test)', async () => {
  const user = await createUser('be-2');
  const account = await createBalanceAccount(user.id, 5000);
  const pm = await createPayoutMethod(user.id);
  try {
    const withdrawal = await prisma.withdrawal.create({
      data: {
        userId: user.id,
        payoutMethodId: pm.id,
        amountPence: 1000,
        status: 'PENDING',
        idempotencyKey: 'test-be2-key',
      },
    });

    await prisma.balanceEntry.create({
      data: {
        balanceAccountId: account.id,
        userId: user.id,
        type: 'WITHDRAWAL_DEBIT',
        amountPence: 1000,
        currency: 'GBP',
        direction: 'DEBIT',
        referenceType: 'WITHDRAWAL',
        referenceId: withdrawal.id,
        description: 'Debit',
      },
    });

    let threw = false;
    try {
      await prisma.balanceEntry.create({
        data: {
          balanceAccountId: account.id,
          userId: user.id,
          type: 'WITHDRAWAL_REVERSAL',
          amountPence: 1000,
          currency: 'GBP',
          direction: 'CREDIT',
          referenceType: 'WITHDRAWAL',
          referenceId: withdrawal.id,
          description: 'Reversal',
        },
      });
    } catch { threw = true; }
    assert.ok(threw, 'Old WITHDRAWAL referenceType should collide on unique constraint');
  } finally {
    await cleanupUser(user.id);
  }
});

// ---------------------------------------------------------------------------
// Withdrawal lifecycle tests
// ---------------------------------------------------------------------------

check('Withdrawal lifecycle: PENDING -> PROCESSING -> COMPLETED', async () => {
  const user = await createUser('w-lc1');
  const account = await createBalanceAccount(user.id, 5000);
  const pm = await createPayoutMethod(user.id);
  const ca = await createConnectedAccount(user.id, 'acct_wlc1');
  try {
    const w = await prisma.withdrawal.create({
      data: {
        userId: user.id,
        payoutMethodId: pm.id,
        amountPence: 1000,
        status: 'PENDING',
        idempotencyKey: 'withdrawal:wlc1',
      },
    });

    await prisma.withdrawal.update({
      where: { id: w.id },
      data: { status: 'PROCESSING', stripePayoutId: 'po_test_1', processedAt: new Date() },
    });
    const processing = await prisma.withdrawal.findUnique({ where: { id: w.id } });
    assert.equal(processing.status, 'PROCESSING');

    await prisma.withdrawal.update({
      where: { id: w.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const completed = await prisma.withdrawal.findUnique({ where: { id: w.id } });
    assert.equal(completed.status, 'COMPLETED');
    assert.ok(completed.completedAt);
  } finally {
    await cleanupUser(user.id);
  }
});

check('Withdrawal lifecycle: PENDING -> FAILED with reversal', async () => {
  const user = await createUser('w-lc2');
  const account = await createBalanceAccount(user.id, 5000);
  const pm = await createPayoutMethod(user.id);
  try {
    const w = await prisma.withdrawal.create({
      data: {
        userId: user.id,
        payoutMethodId: pm.id,
        amountPence: 1000,
        status: 'PENDING',
        idempotencyKey: 'withdrawal:wlc2',
      },
    });

    await prisma.withdrawal.update({
      where: { id: w.id },
      data: { status: 'FAILED', failedAt: new Date(), reversalReason: 'Bank error' },
    });
    const failed = await prisma.withdrawal.findUnique({ where: { id: w.id } });
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.reversalReason, 'Bank error');
    assert.ok(failed.failedAt);
  } finally {
    await cleanupUser(user.id);
  }
});

check('Withdrawal lifecycle: PENDING -> CANCELLED', async () => {
  const user = await createUser('w-lc3');
  const account = await createBalanceAccount(user.id, 5000);
  const pm = await createPayoutMethod(user.id);
  try {
    const w = await prisma.withdrawal.create({
      data: {
        userId: user.id,
        payoutMethodId: pm.id,
        amountPence: 1000,
        status: 'PENDING',
        idempotencyKey: 'withdrawal:wlc3',
      },
    });

    await prisma.withdrawal.update({
      where: { id: w.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    const cancelled = await prisma.withdrawal.findUnique({ where: { id: w.id } });
    assert.equal(cancelled.status, 'CANCELLED');
    assert.ok(cancelled.cancelledAt);
  } finally {
    await cleanupUser(user.id);
  }
});

check('payoutsDisabled blocks withdrawal creation', async () => {
  const user = await createUser('w-pd');
  const account = await createBalanceAccount(user.id, 5000);
  const pm = await createPayoutMethod(user.id);
  const ca = await createConnectedAccount(user.id, 'acct_wpd');
  try {
    await prisma.user.update({ where: { id: user.id }, data: { payoutsDisabled: true } });
    const { requestWithdrawal } = await import('../apps/api/src/services/withdrawal.js');
    let threw = false;
    try {
      await requestWithdrawal({ userId: user.id, amountPence: 1000 });
    } catch (err) { threw = true; assert.ok(err.message.includes('disabled')); }
    assert.ok(threw, 'Should throw when payoutsDisabled');
  } finally {
    await cleanupUser(user.id);
  }
});

check('Insufficient balance blocks withdrawal', async () => {
  const user = await createUser('w-ib');
  const account = await createBalanceAccount(user.id, 100);
  const pm = await createPayoutMethod(user.id);
  const ca = await createConnectedAccount(user.id, 'acct_wib');
  try {
    const { requestWithdrawal } = await import('../apps/api/src/services/withdrawal.js');
    let threw = false;
    try {
      await requestWithdrawal({ userId: user.id, amountPence: 1000 });
    } catch (err) { threw = true; assert.ok(err.message.includes('Insufficient')); }
    assert.ok(threw, 'Should throw on insufficient balance');
  } finally {
    await cleanupUser(user.id);
  }
});

check('No connected account blocks withdrawal', async () => {
  const user = await createUser('w-nca');
  const account = await createBalanceAccount(user.id, 5000);
  const pm = await createPayoutMethod(user.id);
  try {
    const { requestWithdrawal } = await import('../apps/api/src/services/withdrawal.js');
    let threw = false;
    try {
      await requestWithdrawal({ userId: user.id, amountPence: 1000 });
    } catch (err) { threw = true; assert.ok(err.message.includes('onboarding')); }
    assert.ok(threw, 'Should throw without connected account');
  } finally {
    await cleanupUser(user.id);
  }
});

check('Restricted connected account blocks withdrawal', async () => {
  const user = await createUser('w-rca');
  const account = await createBalanceAccount(user.id, 5000);
  const pm = await createPayoutMethod(user.id);
  const ca = await createConnectedAccount(user.id, 'acct_wrca', 'RESTRICTED');
  try {
    const { requestWithdrawal } = await import('../apps/api/src/services/withdrawal.js');
    let threw = false;
    try {
      await requestWithdrawal({ userId: user.id, amountPence: 1000 });
    } catch (err) { threw = true; assert.ok(err.message.includes('restricted')); }
    assert.ok(threw, 'Should throw for restricted account');
  } finally {
    await cleanupUser(user.id);
  }
});

check('Minimum withdrawal amount enforced', async () => {
  const user = await createUser('w-min');
  const account = await createBalanceAccount(user.id, 5000);
  const pm = await createPayoutMethod(user.id);
  const ca = await createConnectedAccount(user.id, 'acct_wmin');
  try {
    const { requestWithdrawal } = await import('../apps/api/src/services/withdrawal.js');
    let threw = false;
    try {
      await requestWithdrawal({ userId: user.id, amountPence: 100 });
    } catch (err) { threw = true; assert.ok(err.message.includes('Minimum')); }
    assert.ok(threw, 'Should throw below minimum');
  } finally {
    await cleanupUser(user.id);
  }
});

check('handlePayoutWebhook is idempotent', async () => {
  const user = await createUser('w-idem');
  const account = await createBalanceAccount(user.id, 0);
  const pm = await createPayoutMethod(user.id);
  try {
    const w = await prisma.withdrawal.create({
      data: {
        userId: user.id,
        payoutMethodId: pm.id,
        amountPence: 1000,
        status: 'PROCESSING',
        idempotencyKey: 'withdrawal:widem',
        stripePayoutId: 'po_idem_1',
      },
    });

    const { handlePayoutWebhook } = await import('../apps/api/src/services/withdrawal.js');

    await handlePayoutWebhook({ stripePayoutId: 'po_idem_1', status: 'paid' });
    const after1 = await prisma.withdrawal.findUnique({ where: { id: w.id } });
    assert.equal(after1.status, 'COMPLETED');

    await handlePayoutWebhook({ stripePayoutId: 'po_idem_1', status: 'paid' });
    const after2 = await prisma.withdrawal.findUnique({ where: { id: w.id } });
    assert.equal(after2.status, 'COMPLETED', 'Duplicate webhook should be safe');
  } finally {
    await cleanupUser(user.id);
  }
});

check('handlePayoutWebhook failed reverses balance', async () => {
  const user = await createUser('w-fail');
  const account = await createBalanceAccount(user.id, 0);
  const pm = await createPayoutMethod(user.id);
  try {
    const w = await prisma.withdrawal.create({
      data: {
        userId: user.id,
        payoutMethodId: pm.id,
        amountPence: 1000,
        status: 'PROCESSING',
        idempotencyKey: 'withdrawal:wfail',
        stripePayoutId: 'po_fail_1',
      },
    });

    const { handlePayoutWebhook } = await import('../apps/api/src/services/withdrawal.js');
    await handlePayoutWebhook({ stripePayoutId: 'po_fail_1', status: 'failed' });

    const after = await prisma.withdrawal.findUnique({ where: { id: w.id } });
    assert.equal(after.status, 'FAILED');

    const bal = await prisma.balanceAccount.findUnique({ where: { userId: user.id } });
    assert.equal(bal.availableBalancePence, 1000, 'Balance should be reversed');

    const reversalEntry = await prisma.balanceEntry.findFirst({
      where: { userId: user.id, type: 'WITHDRAWAL_REVERSAL' },
    });
    assert.ok(reversalEntry, 'Reversal entry should exist');
    assert.equal(reversalEntry.referenceType, 'WITHDRAWAL_REVERSAL');
  } finally {
    await cleanupUser(user.id);
  }
});

check('handlePayoutWebhook canceled reverses balance', async () => {
  const user = await createUser('w-cancel');
  const account = await createBalanceAccount(user.id, 0);
  const pm = await createPayoutMethod(user.id);
  try {
    const w = await prisma.withdrawal.create({
      data: {
        userId: user.id,
        payoutMethodId: pm.id,
        amountPence: 1000,
        status: 'PROCESSING',
        idempotencyKey: 'withdrawal:wcancel',
        stripePayoutId: 'po_cancel_1',
      },
    });

    const { handlePayoutWebhook } = await import('../apps/api/src/services/withdrawal.js');
    await handlePayoutWebhook({ stripePayoutId: 'po_cancel_1', status: 'canceled' });

    const after = await prisma.withdrawal.findUnique({ where: { id: w.id } });
    assert.equal(after.status, 'FAILED', 'Canceled should map to FAILED');

    const bal = await prisma.balanceAccount.findUnique({ where: { userId: user.id } });
    assert.equal(bal.availableBalancePence, 1000, 'Balance should be reversed');
  } finally {
    await cleanupUser(user.id);
  }
});

check('handlePayoutWebhook ignores unknown payout ID', async () => {
  const { handlePayoutWebhook } = await import('../apps/api/src/services/withdrawal.js');
  await handlePayoutWebhook({ stripePayoutId: 'po_nonexistent', status: 'paid' });
  assert.ok(true, 'Should not throw for unknown payout');
});

// ---------------------------------------------------------------------------
// ValueGap state transition tests
// ---------------------------------------------------------------------------

check('ValueGap lifecycle: PENDING -> HELD -> RELEASED', async () => {
  const user1 = await createUser('vg-1a');
  const user2 = await createUser('vg-1b');
  const item1 = await prisma.item.create({ data: { ownerId: user1.id, title: 'A', description: 'A', category: 'ELECTRONICS', condition: 'GOOD', valuePence: 1000 } });
  const item2 = await prisma.item.create({ data: { ownerId: user2.id, title: 'B', description: 'B', category: 'ELECTRONICS', condition: 'GOOD', valuePence: 2000 } });
  const swap = await prisma.swap.create({ data: { offeringUserId: user1.id, offeringItemId: item1.id, requestedUserId: user2.id, requestedItemId: item2.id, gapPence: 1000, gapPayer: 'OFFERING_USER', status: 'PAID' } });
  const payment = await prisma.payment.create({ data: { swapId: swap.id, payerUserId: user1.id, amountPence: 1000, feePence: 50, totalPence: 1050, status: 'PAID', paidAt: new Date() } });
  try {
    const { allocateValueGap, releaseValueGap } = await import('../apps/api/src/services/value-gap.js');

    await prisma.$transaction(async (tx) => {
      await allocateValueGap(tx, { paymentId: payment.id, swapId: swap.id, payerUserId: user1.id, valueGapPence: 1000, serviceFeePence: 50 });
    });
    const held = await prisma.valueGap.findUnique({ where: { paymentId: payment.id } });
    assert.equal(held.state, 'HELD');

    await prisma.$transaction(async (tx) => {
      await releaseValueGap(tx, swap.id);
    });
    const released = await prisma.valueGap.findUnique({ where: { paymentId: payment.id } });
    assert.equal(released.state, 'RELEASED');
    assert.ok(released.releasedAt);
  } finally {
    await prisma.balanceEntry.deleteMany({ where: { userId: { in: [user1.id, user2.id] } } });
    await prisma.valueGap.deleteMany({ where: { swapId: swap.id } });
    await prisma.payment.deleteMany({ where: { swapId: swap.id } });
    await prisma.swap.delete({ where: { id: swap.id } });
    await prisma.item.deleteMany({ where: { id: { in: [item1.id, item2.id] } } });
    await cleanupUser(user1.id);
    await cleanupUser(user2.id);
  }
});

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function run() {
  let passed = 0;
  let failed = 0;

  for (const { name, fn } of results) {
    try {
      await fn();
      console.log(`  PASS  ${name}`);
      passed++;
    } catch (err) {
      console.error(`  FAIL  ${name}`);
      console.error(`        ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${passed}/${passed + failed} Stripe Connect Phase B checks passed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});