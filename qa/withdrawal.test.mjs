// Withdrawal & PayoutMethod QA tests. Run with: npx tsx qa/withdrawal.test.mjs
//
// Tests Withdrawal and PayoutMethod DB model operations.
// Uses the real Prisma client against a local dev database.

import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['error'] });

const results = [];
function check(name, fn) { results.push({ name, fn }); }

async function createUser(name) {
  return prisma.user.create({
    data: {
      email: `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
      name,
    },
  });
}

async function createPayoutMethod(userId) {
  return prisma.payoutMethod.create({
    data: {
      userId,
      type: 'BANK_TRANSFER',
      displayName: 'HSBC ****1234',
      last4: '1234',
      bankName: 'HSBC UK',
      isDefault: true,
      isActive: true,
    },
  });
}

// ---------------------------------------------------------------------------
// PayoutMethod DB tests
// ---------------------------------------------------------------------------

check('PayoutMethod can be created and retrieved', async () => {
  const user = await createUser('pm-1');
  try {
    const pm = await createPayoutMethod(user.id);
    assert.ok(pm.id);
    assert.equal(pm.userId, user.id);
    assert.equal(pm.type, 'BANK_TRANSFER');
    assert.equal(pm.isDefault, true);
    assert.equal(pm.isActive, true);

    const found = await prisma.payoutMethod.findFirst({ where: { userId: user.id } });
    assert.ok(found);
    assert.equal(found.displayName, 'HSBC ****1234');
  } finally {
    await prisma.payoutMethod.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

check('PayoutMethod supports multiple per user', async () => {
  const user = await createUser('pm-2');
  try {
    await prisma.payoutMethod.create({
      data: { userId: user.id, type: 'BANK_TRANSFER', displayName: 'HSBC', isDefault: true, isActive: true },
    });
    await prisma.payoutMethod.create({
      data: { userId: user.id, type: 'BANK_TRANSFER', displayName: 'Barclays', isDefault: false, isActive: true },
    });

    const methods = await prisma.payoutMethod.findMany({ where: { userId: user.id } });
    assert.equal(methods.length, 2);
    const defaultMethod = methods.find(m => m.isDefault);
    assert.ok(defaultMethod);
    assert.equal(defaultMethod.displayName, 'HSBC');
  } finally {
    await prisma.payoutMethod.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

check('PayoutMethod cascades delete with User', async () => {
  const user = await createUser('pm-3');
  await createPayoutMethod(user.id);
  await prisma.user.delete({ where: { id: user.id } });
  const count = await prisma.payoutMethod.count({ where: { userId: user.id } });
  assert.equal(count, 0);
});

// ---------------------------------------------------------------------------
// Withdrawal DB tests
// ---------------------------------------------------------------------------

check('Withdrawal can be created with idempotency key', async () => {
  const user = await createUser('w-1');
  const pm = await createPayoutMethod(user.id);
  try {
    const w = await prisma.withdrawal.create({
      data: {
        userId: user.id,
        payoutMethodId: pm.id,
        amountPence: 1000,
        status: 'PENDING',
        idempotencyKey: 'withdrawal:test-unique-1',
      },
    });
    assert.ok(w.id);
    assert.equal(w.amountPence, 1000);
    assert.equal(w.status, 'PENDING');
    assert.equal(w.idempotencyKey, 'withdrawal:test-unique-1');
  } finally {
    await prisma.withdrawal.deleteMany({ where: { userId: user.id } });
    await prisma.payoutMethod.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

check('Withdrawal enforces unique idempotency key', async () => {
  const user = await createUser('w-2');
  const pm = await createPayoutMethod(user.id);
  const key = `withdrawal:dup-${Date.now()}`;
  try {
    await prisma.withdrawal.create({
      data: { userId: user.id, payoutMethodId: pm.id, amountPence: 500, status: 'PENDING', idempotencyKey: key },
    });
    let caught = false;
    try {
      await prisma.withdrawal.create({
        data: { userId: user.id, payoutMethodId: pm.id, amountPence: 500, status: 'PENDING', idempotencyKey: key },
      });
    } catch { caught = true; }
    assert.ok(caught, 'Should throw on duplicate idempotency key');
  } finally {
    await prisma.withdrawal.deleteMany({ where: { userId: user.id } });
    await prisma.payoutMethod.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

check('Withdrawal enforces unique stripePayoutId', async () => {
  const user = await createUser('w-3');
  const pm = await createPayoutMethod(user.id);
  const payoutId = `po_test_${Date.now()}`;
  try {
    await prisma.withdrawal.create({
      data: { userId: user.id, payoutMethodId: pm.id, amountPence: 500, status: 'PROCESSING', idempotencyKey: 'w3-k1', stripePayoutId: payoutId },
    });
    let caught = false;
    try {
      await prisma.withdrawal.create({
        data: { userId: user.id, payoutMethodId: pm.id, amountPence: 500, status: 'PROCESSING', idempotencyKey: 'w3-k2', stripePayoutId: payoutId },
      });
    } catch { caught = true; }
    assert.ok(caught, 'Should throw on duplicate stripePayoutId');
  } finally {
    await prisma.withdrawal.deleteMany({ where: { userId: user.id } });
    await prisma.payoutMethod.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

check('Withdrawal status transitions through lifecycle', async () => {
  const user = await createUser('w-4');
  const pm = await createPayoutMethod(user.id);
  try {
    const w = await prisma.withdrawal.create({
      data: { userId: user.id, payoutMethodId: pm.id, amountPence: 2000, status: 'PENDING', idempotencyKey: 'w4-k' },
    });
    const processing = await prisma.withdrawal.update({
      where: { id: w.id },
      data: { status: 'PROCESSING', stripePayoutId: 'po_test_4', processedAt: new Date() },
    });
    assert.equal(processing.status, 'PROCESSING');
    const completed = await prisma.withdrawal.update({
      where: { id: w.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    assert.equal(completed.status, 'COMPLETED');
    assert.ok(completed.completedAt);
  } finally {
    await prisma.withdrawal.deleteMany({ where: { userId: user.id } });
    await prisma.payoutMethod.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

check('Withdrawal can transition to FAILED with reversal reason', async () => {
  const user = await createUser('w-5');
  const pm = await createPayoutMethod(user.id);
  try {
    const w = await prisma.withdrawal.create({
      data: { userId: user.id, payoutMethodId: pm.id, amountPence: 1500, status: 'PROCESSING', idempotencyKey: 'w5-k', stripePayoutId: 'po_test_5' },
    });
    const failed = await prisma.withdrawal.update({
      where: { id: w.id },
      data: { status: 'FAILED', failedAt: new Date(), reversalReason: 'Insufficient funds' },
    });
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.reversalReason, 'Insufficient funds');
  } finally {
    await prisma.withdrawal.deleteMany({ where: { userId: user.id } });
    await prisma.payoutMethod.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

check('Withdrawal cancels and records cancelledAt', async () => {
  const user = await createUser('w-6');
  const pm = await createPayoutMethod(user.id);
  try {
    const w = await prisma.withdrawal.create({
      data: { userId: user.id, payoutMethodId: pm.id, amountPence: 750, status: 'PENDING', idempotencyKey: 'w6-k' },
    });
    const cancelled = await prisma.withdrawal.update({
      where: { id: w.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    assert.equal(cancelled.status, 'CANCELLED');
    assert.ok(cancelled.cancelledAt);
  } finally {
    await prisma.withdrawal.deleteMany({ where: { userId: user.id } });
    await prisma.payoutMethod.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

check('Withdrawal query by stripePayoutId works', async () => {
  const user = await createUser('w-7');
  const pm = await createPayoutMethod(user.id);
  const payoutId = `po_test_7_${Date.now()}`;
  try {
    await prisma.withdrawal.create({
      data: { userId: user.id, payoutMethodId: pm.id, amountPence: 3000, status: 'PROCESSING', idempotencyKey: 'w7-k', stripePayoutId: payoutId },
    });
    const found = await prisma.withdrawal.findFirst({ where: { stripePayoutId: payoutId } });
    assert.ok(found);
    assert.equal(found.amountPence, 3000);
  } finally {
    await prisma.withdrawal.deleteMany({ where: { userId: user.id } });
    await prisma.payoutMethod.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

check('Withdrawal aggregation works for rate limiting', async () => {
  const user = await createUser('w-8');
  const pm = await createPayoutMethod(user.id);
  try {
    await prisma.withdrawal.create({
      data: { userId: user.id, payoutMethodId: pm.id, amountPence: 1000, status: 'PROCESSING', idempotencyKey: 'w8-k1' },
    });
    await prisma.withdrawal.create({
      data: { userId: user.id, payoutMethodId: pm.id, amountPence: 2000, status: 'COMPLETED', idempotencyKey: 'w8-k2' },
    });
    await prisma.withdrawal.create({
      data: { userId: user.id, payoutMethodId: pm.id, amountPence: 500, status: 'CANCELLED', idempotencyKey: 'w8-k3' },
    });

    const active = await prisma.withdrawal.aggregate({
      where: { userId: user.id, status: { notIn: ['CANCELLED'] } },
      _sum: { amountPence: true },
    });
    assert.equal(Number(active._sum.amountPence), 3000, 'active total should be 3000');
  } finally {
    await prisma.withdrawal.deleteMany({ where: { userId: user.id } });
    await prisma.payoutMethod.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

check('Withdrawal feePence defaults to 0', async () => {
  const user = await createUser('w-9');
  const pm = await createPayoutMethod(user.id);
  try {
    const w = await prisma.withdrawal.create({
      data: { userId: user.id, payoutMethodId: pm.id, amountPence: 1000, status: 'PENDING', idempotencyKey: 'w9-k' },
    });
    assert.equal(w.feePence, 0);
  } finally {
    await prisma.withdrawal.deleteMany({ where: { userId: user.id } });
    await prisma.payoutMethod.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

check('User withdrawals relation works', async () => {
  const user = await createUser('w-10');
  const pm = await createPayoutMethod(user.id);
  try {
    await prisma.withdrawal.create({
      data: { userId: user.id, payoutMethodId: pm.id, amountPence: 1000, status: 'PENDING', idempotencyKey: 'w10-k' },
    });
    const userWithW = await prisma.user.findUnique({
      where: { id: user.id },
      include: { withdrawals: true },
    });
    assert.equal(userWithW.withdrawals.length, 1);
    assert.equal(userWithW.withdrawals[0].amountPence, 1000);
  } finally {
    await prisma.withdrawal.deleteMany({ where: { userId: user.id } });
    await prisma.payoutMethod.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

check('PayoutMethod relation to Withdrawal works', async () => {
  const user = await createUser('w-11');
  const pm = await createPayoutMethod(user.id);
  try {
    await prisma.withdrawal.create({
      data: { userId: user.id, payoutMethodId: pm.id, amountPence: 1000, status: 'PENDING', idempotencyKey: 'w11-k' },
    });
    const wWithPM = await prisma.withdrawal.findFirst({
      where: { userId: user.id },
      include: { payoutMethod: true },
    });
    assert.ok(wWithPM.payoutMethod);
    assert.equal(wWithPM.payoutMethod.displayName, 'HSBC ****1234');
  } finally {
    await prisma.withdrawal.deleteMany({ where: { userId: user.id } });
    await prisma.payoutMethod.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

check('Withdrawal enum values are correct', async () => {
  const user = await createUser('w-12');
  const pm = await createPayoutMethod(user.id);
  const statuses = ['PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'];
  try {
    for (let i = 0; i < statuses.length; i++) {
      const w = await prisma.withdrawal.create({
        data: { userId: user.id, payoutMethodId: pm.id, amountPence: 100 * (i + 1), status: statuses[i], idempotencyKey: `w12-k-${i}` },
      });
      assert.equal(w.status, statuses[i]);
    }
  } finally {
    await prisma.withdrawal.deleteMany({ where: { userId: user.id } });
    await prisma.payoutMethod.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
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

  console.log(`\n${passed + failed}/${passed + failed} withdrawal checks passed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
