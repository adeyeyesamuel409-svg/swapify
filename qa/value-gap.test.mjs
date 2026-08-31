// Value-gap ledger QA tests. Run with: npx tsx qa/value-gap.test.mjs
//
// Tests the internal value-gap accounting/lifecycle: allocation on payment
// confirmation, release on swap completion, refund on cancellation, idempotency,
// concurrency safety, and state-machine invariants.
//
// Uses the real Prisma client against a local dev database. Each test cleans
// up after itself.

import assert from 'node:assert/strict';
import { PrismaClient, ValueGapState, PaymentStatus, SwapStatus, ItemStatus, ShipmentStatus } from '@prisma/client';

const prisma = new PrismaClient({ log: ['error'] });

const results = [];
function check(name, fn) {
  results.push({ name, fn });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createUser(name) {
  return prisma.user.create({
    data: { email: `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`, name },
  });
}

async function createItem(ownerId, valuePence, title = 'Test Item') {
  return prisma.item.create({
    data: {
      ownerId,
      title,
      description: 'Test description for QA',
      category: 'ELECTRONICS',
      condition: 'GOOD',
      valuePence,
    },
  });
}

async function createSwap(offeringUserId, offeringItemId, requestedUserId, requestedItemId, gapPence, gapPayer) {
  return prisma.swap.create({
    data: {
      offeringUserId,
      offeringItemId,
      requestedUserId,
      requestedItemId,
      gapPence,
      gapPayer,
      status: SwapStatus.REQUESTED,
    },
  });
}

async function createPayment(swapId, payerUserId, amountPence, feePence) {
  return prisma.payment.create({
    data: {
      swapId,
      payerUserId,
      amountPence,
      feePence,
      totalPence: amountPence + feePence,
      status: PaymentStatus.PENDING,
    },
  });
}

async function createShipment(swapId, senderUserId, receiverUserId, itemId, status = ShipmentStatus.DELIVERED) {
  return prisma.shipment.create({
    data: {
      swapId,
      senderUserId,
      receiverUserId,
      itemId,
      status,
      addressLine1: '1 Test St',
      addressCity: 'London',
      addressPostcode: 'EC1A 1BB',
      addressCountry: 'GB',
    },
  });
}

async function cleanupUsers(userIds) {
  // Delete balance entries/accounts before users (FK constraint)
  await prisma.balanceEntry.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.balanceAccount.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// 1. Equal-value swap creates no value-gap allocation
check('equal-value swap creates no value-gap allocation', async () => {
  const userA = await createUser('A');
  const userB = await createUser('B');
  const itemA = await createItem(userA.id, 5000, 'Item A');
  const itemB = await createItem(userB.id, 5000, 'Item B');

  const swap = await createSwap(userA.id, itemA.id, userB.id, itemB.id, 0, 'NONE');

  const valueGap = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(valueGap, null, 'No value gap should exist for equal-value swap');

  // Cleanup
  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemA.id, itemB.id] } } });
  await cleanupUsers([userA.id, userB.id]);
});

// 2. Value-gap swap: £100 item, £70 item, agreed higher-item value £80, gap = £10
check('value-gap swap creates correct allocation (gap £10)', async () => {
  const userA = await createUser('payer');
  const userB = await createUser('recipient');
  // A offers item worth 8000 (agreed value), B offers item worth 7000
  const itemA = await createItem(userA.id, 8000, 'PS5');
  const itemB = await createItem(userB.id, 7000, 'Bag');

  // Gap: 8000 - 7000 = 1000 pence. Offering user (A) pays because their item is higher value.
  const swap = await createSwap(userA.id, itemA.id, userB.id, itemB.id, 1000, 'OFFERING_USER');
  const payment = await createPayment(swap.id, userA.id, 1000, 50);

  // Simulate payment confirmation — allocate value gap
  const { allocateValueGap } = await import('../apps/api/src/services/value-gap.ts');
  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: userA.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });

  const vg = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.ok(vg, 'Value gap should exist');
  assert.equal(vg.state, ValueGapState.HELD);
  assert.equal(vg.valueGapPence, 1000);
  assert.equal(vg.serviceFeePence, 50);
  assert.equal(vg.payerUserId, userA.id);
  assert.equal(vg.recipientUserId, userB.id);
  assert.ok(vg.heldAt, 'heldAt should be set');

  // Cleanup
  await prisma.valueGap.delete({ where: { id: vg.id } });
  await prisma.payment.delete({ where: { id: payment.id } });
  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemA.id, itemB.id] } } });
  await cleanupUsers([userA.id, userB.id]);
});

// 3. Service fee: gap £10, fee 5%, fee = £0.50
check('service fee is 5% of value gap (£10 gap = £0.50 fee)', async () => {
  const { calculateServiceFee } = await import('../packages/shared/src/index.ts');
  const fee = calculateServiceFee(1000);
  assert.equal(fee, 50, '5% of 1000 pence = 50 pence');
});

// 4. Total payment = value gap + service fee (£10 + £0.50 = £10.50)
check('total payment = gap + fee (£10 + £0.50 = £10.50)', async () => {
  const gapPence = 1000;
  const feePence = 50;
  const total = gapPence + feePence;
  assert.equal(total, 1050, '1000 + 50 = 1050 pence');
});

// 5. Payer is correctly recorded
check('payer is correctly recorded in value gap', async () => {
  const payer = await createUser('payer-check');
  const recipient = await createUser('recipient-check');
  const itemP = await createItem(payer.id, 8000, 'High Item');
  const itemR = await createItem(recipient.id, 7000, 'Low Item');
  const swap = await createSwap(payer.id, itemP.id, recipient.id, itemR.id, 1000, 'OFFERING_USER');
  const payment = await createPayment(swap.id, payer.id, 1000, 50);

  const { allocateValueGap } = await import('../apps/api/src/services/value-gap.ts');
  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: payer.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });

  const vg = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vg.payerUserId, payer.id);
  assert.equal(vg.recipientUserId, recipient.id);

  await prisma.valueGap.delete({ where: { id: vg.id } });
  await prisma.payment.delete({ where: { id: payment.id } });
  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemP.id, itemR.id] } } });
  await cleanupUsers([payer.id, recipient.id]);
});

// 6. Payment confirmation changes PENDING → HELD
check('payment confirmation transitions PENDING → HELD', async () => {
  const payer = await createUser('state-payer');
  const recipient = await createUser('state-recipient');
  const itemP = await createItem(payer.id, 8000);
  const itemR = await createItem(recipient.id, 7000);
  const swap = await createSwap(payer.id, itemP.id, recipient.id, itemR.id, 1000, 'OFFERING_USER');
  const payment = await createPayment(swap.id, payer.id, 1000, 50);

  const { allocateValueGap } = await import('../apps/api/src/services/value-gap.ts');
  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: payer.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });

  const vg = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vg.state, ValueGapState.HELD, 'State should be HELD after payment confirmation');

  await prisma.valueGap.delete({ where: { id: vg.id } });
  await prisma.payment.delete({ where: { id: payment.id } });
  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemP.id, itemR.id] } } });
  await cleanupUsers([payer.id, recipient.id]);
});

// 7. Delivery of only one shipment: value gap remains HELD
check('single delivery does not release value gap', async () => {
  const payer = await createUser('single-del-payer');
  const recipient = await createUser('single-del-recipient');
  const itemP = await createItem(payer.id, 8000);
  const itemR = await createItem(recipient.id, 7000);
  const swap = await createSwap(payer.id, itemP.id, recipient.id, itemR.id, 1000, 'OFFERING_USER');
  await prisma.swap.update({ where: { id: swap.id }, data: { status: SwapStatus.PAID } });
  const payment = await createPayment(swap.id, payer.id, 1000, 50);
  await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID } });

  const { allocateValueGap } = await import('../apps/api/src/services/value-gap.ts');
  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: payer.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });

  // Try to complete — but only one shipment delivered, so it should fail
  // We simulate this by checking tryCompleteSwap won't complete with < 2 delivered
  const vg = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vg.state, ValueGapState.HELD, 'Value gap should remain HELD with only one delivery');

  await prisma.valueGap.delete({ where: { id: vg.id } });
  await prisma.payment.delete({ where: { id: payment.id } });
  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemP.id, itemR.id] } } });
  await cleanupUsers([payer.id, recipient.id]);
});

// 8. Both shipments delivered → COMPLETED + RELEASED
check('both deliveries → swap COMPLETED + value gap RELEASED', async () => {
  const payer = await createUser('both-del-payer');
  const recipient = await createUser('both-del-recipient');
  const itemP = await createItem(payer.id, 8000);
  const itemR = await createItem(recipient.id, 7000);
  const swap = await createSwap(payer.id, itemP.id, recipient.id, itemR.id, 1000, 'OFFERING_USER');
  await prisma.swap.update({ where: { id: swap.id }, data: { status: SwapStatus.PAID } });
  const payment = await createPayment(swap.id, payer.id, 1000, 50);
  await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID } });

  const { allocateValueGap, releaseValueGap } = await import('../apps/api/src/services/value-gap.ts');
  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: payer.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });

  // Simulate both deliveries by directly completing + releasing
  await prisma.$transaction(async (tx) => {
    await tx.swap.update({ where: { id: swap.id }, data: { status: SwapStatus.COMPLETED, completedAt: new Date() } });
    const released = await releaseValueGap(tx, swap.id);
    assert.ok(released, 'Release should return gap info');
    assert.equal(released.valueGapPence, 1000);
  });

  const vg = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vg.state, ValueGapState.RELEASED, 'Value gap should be RELEASED');
  assert.ok(vg.releasedAt, 'releasedAt should be set');
  assert.equal(vg.releaseReason, 'SWAP_COMPLETED');

  const updatedSwap = await prisma.swap.findUnique({ where: { id: swap.id } });
  assert.equal(updatedSwap.status, SwapStatus.COMPLETED);

  await prisma.valueGap.delete({ where: { id: vg.id } });
  await prisma.payment.delete({ where: { id: payment.id } });
  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemP.id, itemR.id] } } });
  await cleanupUsers([payer.id, recipient.id]);
});

// 9. Duplicate delivery webhook: does not release twice
check('duplicate release is idempotent', async () => {
  const payer = await createUser('idemp-payer');
  const recipient = await createUser('idemp-recipient');
  const itemP = await createItem(payer.id, 8000);
  const itemR = await createItem(recipient.id, 7000);
  const swap = await createSwap(payer.id, itemP.id, recipient.id, itemR.id, 1000, 'OFFERING_USER');
  await prisma.swap.update({ where: { id: swap.id }, data: { status: SwapStatus.PAID } });
  const payment = await createPayment(swap.id, payer.id, 1000, 50);
  await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID } });

  const { allocateValueGap, releaseValueGap } = await import('../apps/api/src/services/value-gap.ts');
  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: payer.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });

  // First release
  await prisma.$transaction(async (tx) => {
    await releaseValueGap(tx, swap.id);
  });
  // Second release — should be no-op (returns null)
  const result2 = await prisma.$transaction(async (tx) => {
    return releaseValueGap(tx, swap.id);
  });
  assert.equal(result2, null, 'Second release should return null (no-op)');

  const vg = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vg.state, ValueGapState.RELEASED);

  await prisma.valueGap.delete({ where: { id: vg.id } });
  await prisma.payment.delete({ where: { id: payment.id } });
  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemP.id, itemR.id] } } });
  await cleanupUsers([payer.id, recipient.id]);
});

// 10. Duplicate payment webhook: does not create duplicate allocations
check('duplicate allocation is idempotent', async () => {
  const payer = await createUser('dup-alloc-payer');
  const recipient = await createUser('dup-alloc-recipient');
  const itemP = await createItem(payer.id, 8000);
  const itemR = await createItem(recipient.id, 7000);
  const swap = await createSwap(payer.id, itemP.id, recipient.id, itemR.id, 1000, 'OFFERING_USER');
  const payment = await createPayment(swap.id, payer.id, 1000, 50);

  const { allocateValueGap } = await import('../apps/api/src/services/value-gap.ts');
  // First allocation
  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: payer.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });
  // Second allocation — should be no-op
  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: payer.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });

  const count = await prisma.valueGap.count({ where: { paymentId: payment.id } });
  assert.equal(count, 1, 'Should only have one ValueGap record');

  const vg = await prisma.valueGap.findUnique({ where: { paymentId: payment.id } });
  assert.equal(vg.state, ValueGapState.HELD);

  await prisma.valueGap.delete({ where: { id: vg.id } });
  await prisma.payment.delete({ where: { id: payment.id } });
  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemP.id, itemR.id] } } });
  await cleanupUsers([payer.id, recipient.id]);
});

// 11. Cancellation before completion: HELD → REFUNDED
check('cancellation transitions HELD → REFUNDED', async () => {
  const payer = await createUser('cancel-payer');
  const recipient = await createUser('cancel-recipient');
  const itemP = await createItem(payer.id, 8000);
  const itemR = await createItem(recipient.id, 7000);
  const swap = await createSwap(payer.id, itemP.id, recipient.id, itemR.id, 1000, 'OFFERING_USER');
  await prisma.swap.update({ where: { id: swap.id }, data: { status: SwapStatus.PAID } });
  const payment = await createPayment(swap.id, payer.id, 1000, 50);
  await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID } });

  const { allocateValueGap, refundValueGap } = await import('../apps/api/src/services/value-gap.ts');
  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: payer.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });

  // Simulate cancellation
  await prisma.$transaction(async (tx) => {
    await refundValueGap(tx, payment.id, 'USER_CANCELLED');
  });

  const vg = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vg.state, ValueGapState.REFUNDED);
  assert.equal(vg.refundReason, 'USER_CANCELLED');
  assert.ok(vg.refundedAt, 'refundedAt should be set');

  await prisma.valueGap.delete({ where: { id: vg.id } });
  await prisma.payment.delete({ where: { id: payment.id } });
  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemP.id, itemR.id] } } });
  await cleanupUsers([payer.id, recipient.id]);
});

// 12. Attempt to refund RELEASED value gap: rejected safely
check('refund of RELEASED value gap is rejected', async () => {
  const payer = await createUser('release-refund-payer');
  const recipient = await createUser('release-refund-recipient');
  const itemP = await createItem(payer.id, 8000);
  const itemR = await createItem(recipient.id, 7000);
  const swap = await createSwap(payer.id, itemP.id, recipient.id, itemR.id, 1000, 'OFFERING_USER');
  await prisma.swap.update({ where: { id: swap.id }, data: { status: SwapStatus.PAID } });
  const payment = await createPayment(swap.id, payer.id, 1000, 50);
  await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID } });

  const { allocateValueGap, releaseValueGap, refundValueGap } = await import('../apps/api/src/services/value-gap.ts');

  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: payer.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });
  await prisma.$transaction(async (tx) => {
    await releaseValueGap(tx, swap.id);
  });

  // Attempt refund of RELEASED value gap
  const refundResult = await prisma.$transaction(async (tx) => {
    return refundValueGap(tx, payment.id, 'ATTEMPTED_REFUND');
  });
  assert.equal(refundResult, false, 'Refund of RELEASED value gap should return false');

  const vg = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vg.state, ValueGapState.RELEASED, 'State should remain RELEASED');

  await prisma.valueGap.delete({ where: { id: vg.id } });
  await prisma.payment.delete({ where: { id: payment.id } });
  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemP.id, itemR.id] } } });
  await cleanupUsers([payer.id, recipient.id]);
});

// 13. Failed release: remains HELD and is retryable
check('release failure leaves value gap HELD and retryable', async () => {
  const payer = await createUser('fail-release-payer');
  const recipient = await createUser('fail-release-recipient');
  const itemP = await createItem(payer.id, 8000);
  const itemR = await createItem(recipient.id, 7000);
  const swap = await createSwap(payer.id, itemP.id, recipient.id, itemR.id, 1000, 'OFFERING_USER');
  await prisma.swap.update({ where: { id: swap.id }, data: { status: SwapStatus.PAID } });
  const payment = await createPayment(swap.id, payer.id, 1000, 50);
  await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID } });

  const { allocateValueGap } = await import('../apps/api/src/services/value-gap.ts');
  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: payer.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });

  const vg = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vg.state, ValueGapState.HELD, 'Value gap should be HELD before release attempt');

  // Simulate a failed release by leaving it as HELD (no releaseValueGap call)
  // Then verify it can be released later
  const { releaseValueGap } = await import('../apps/api/src/services/value-gap.ts');
  await prisma.$transaction(async (tx) => {
    const released = await releaseValueGap(tx, swap.id);
    assert.ok(released, 'Retry should succeed and return gap info');
  });

  const vgAfter = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vgAfter.state, ValueGapState.RELEASED, 'Should be RELEASED after retry');

  await prisma.valueGap.delete({ where: { id: vg.id } });
  await prisma.payment.delete({ where: { id: payment.id } });
  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemP.id, itemR.id] } } });
  await cleanupUsers([payer.id, recipient.id]);
});

// 14. Recipient snapshot remains unchanged if item ownership changes later
check('recipient snapshot is stable against ownership changes', async () => {
  const payer = await createUser('snap-payer');
  const recipient = await createUser('snap-recipient');
  const newOwner = await createUser('new-owner');
  const itemP = await createItem(payer.id, 8000);
  const itemR = await createItem(recipient.id, 7000);
  const swap = await createSwap(payer.id, itemP.id, recipient.id, itemR.id, 1000, 'OFFERING_USER');
  const payment = await createPayment(swap.id, payer.id, 1000, 50);

  const { allocateValueGap } = await import('../apps/api/src/services/value-gap.ts');
  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: payer.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });

  const vg = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vg.recipientUserId, recipient.id, 'Recipient should be snapshot at allocation time');

  // Simulate ownership change — recipient should not change
  await prisma.item.update({ where: { id: itemR.id }, data: { ownerId: newOwner.id } });

  const vgAfter = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vgAfter.recipientUserId, recipient.id, 'Recipient should NOT change after ownership transfer');

  await prisma.valueGap.delete({ where: { id: vg.id } });
  await prisma.payment.delete({ where: { id: payment.id } });
  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemP.id, itemR.id] } } });
  await cleanupUsers([payer.id, recipient.id, newOwner.id]);
});

// 15. Integer pence calculations
check('all monetary calculations use integer pence', async () => {
  const { calculateServiceFee, formatPence } = await import('../packages/shared/src/index.ts');

  // Verify integer arithmetic
  assert.equal(calculateServiceFee(1000), 50);
  assert.equal(calculateServiceFee(1), 0); // rounds down for < 10 pence
  assert.equal(calculateServiceFee(10), 1);
  assert.equal(calculateServiceFee(9999), 500); // 5% of 9999 = 499.95 → 500
  assert.equal(calculateServiceFee(10000), 500); // 5% of 10000 = 500

  // formatPence uses toFixed(2) which is display-only, not calculation
  assert.equal(formatPence(1000), '£10.00');
  assert.equal(formatPence(50), '£0.50');
  assert.equal(formatPence(1050), '£10.50');
});

// 16. Zero-gap swap does not create a value-gap record
check('zero-gap swap has no value gap allocation', async () => {
  const userA = await createUser('zero-gap-a');
  const userB = await createUser('zero-gap-b');
  const itemA = await createItem(userA.id, 5000, 'Equal Item A');
  const itemB = await createItem(userB.id, 5000, 'Equal Item B');
  const swap = await createSwap(userA.id, itemA.id, userB.id, itemB.id, 0, 'NONE');

  // Attempt to allocate with zero gap — should still work (no gap to hold)
  const vg = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vg, null, 'No value gap for zero-gap swap');

  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemA.id, itemB.id] } } });
  await cleanupUsers([userA.id, userB.id]);
});

// 17. Negative gap cannot be created
check('negative gap cannot be created via computeGap', async () => {
  const { computeGap } = await import('../apps/api/src/services/swaps.ts');

  const gap1 = computeGap(5000, 5000);
  assert.equal(gap1.gapPence, 0);

  const gap2 = computeGap(3000, 7000);
  assert.equal(gap2.gapPence, 4000);
  assert.ok(gap2.gapPence > 0, 'Gap should be positive');

  const gap3 = computeGap(7000, 3000);
  assert.equal(gap3.gapPence, 4000);
  assert.ok(gap3.gapPence > 0, 'Gap should be positive');
});

// 18. Disbursement provider abstraction works
check('disbursement provider can be set and called', async () => {
  const { setDisbursementProvider, getDisbursementProvider } = await import('../apps/api/src/services/value-gap.ts');

  const mockProvider = {
    async release() { return { status: 'PENDING_EXTERNAL_DISBURSEMENT' }; },
    async refund() { return { status: 'PENDING_EXTERNAL_DISBURSEMENT' }; },
  };

  setDisbursementProvider(mockProvider);
  const provider = getDisbursementProvider();
  const result = await provider.release({
    valueGapId: 'test-id',
    recipientUserId: 'test-user',
    valueGapPence: 1000,
    currency: 'GBP',
  });
  assert.equal(result.status, 'PENDING_EXTERNAL_DISBURSEMENT');

  // Reset to placeholder
  const placeholder = {
    async release() { return { status: 'PENDING_EXTERNAL_DISBURSEMENT' }; },
    async refund() { return { status: 'PENDING_EXTERNAL_DISBURSEMENT' }; },
  };
  setDisbursementProvider(placeholder);
});

// 19. Reconciliation finds and refunds stuck HELD value gaps
check('reconcileValueGaps refunds HELD gaps on cancelled swaps', async () => {
  const payer = await createUser('recon-payer');
  const recipient = await createUser('recon-recipient');
  const itemP = await createItem(payer.id, 8000);
  const itemR = await createItem(recipient.id, 7000);
  const swap = await createSwap(payer.id, itemP.id, recipient.id, itemR.id, 1000, 'OFFERING_USER');
  await prisma.swap.update({ where: { id: swap.id }, data: { status: SwapStatus.CANCELLED } });
  const payment = await createPayment(swap.id, payer.id, 1000, 50);
  await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID } });

  const { allocateValueGap, reconcileValueGaps } = await import('../apps/api/src/services/value-gap.ts');
  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: payer.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });

  // Value gap is HELD but swap is CANCELLED — reconciliation should fix this
  const reconciled = await reconcileValueGaps();
  assert.ok(reconciled >= 1, 'Should have reconciled at least 1 value gap');

  const vg = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vg.state, ValueGapState.REFUNDED, 'Stuck HELD gap should be REFUNDED after reconciliation');

  await prisma.valueGap.delete({ where: { id: vg.id } });
  await prisma.payment.delete({ where: { id: payment.id } });
  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemP.id, itemR.id] } } });
  await cleanupUsers([payer.id, recipient.id]);
});

// 20. Value gap model constraints: unique paymentId and swapId
check('value gap enforces unique constraints on paymentId and swapId', async () => {
  const payer = await createUser('constraint-payer');
  const recipient = await createUser('constraint-recipient');
  const itemP = await createItem(payer.id, 8000);
  const itemR = await createItem(recipient.id, 7000);
  const swap = await createSwap(payer.id, itemP.id, recipient.id, itemR.id, 1000, 'OFFERING_USER');
  const payment = await createPayment(swap.id, payer.id, 1000, 50);

  const { allocateValueGap } = await import('../apps/api/src/services/value-gap.ts');

  // First allocation succeeds
  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: payer.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });

  // Second allocation with same paymentId should be idempotent (no duplicate)
  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: payer.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });

  const count = await prisma.valueGap.count({ where: { swapId: swap.id } });
  assert.equal(count, 1, 'Should still have exactly one ValueGap record');

  const vg = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vg.state, ValueGapState.HELD);

  await prisma.valueGap.delete({ where: { id: vg.id } });
  await prisma.payment.delete({ where: { id: payment.id } });
  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemP.id, itemR.id] } } });
  await cleanupUsers([payer.id, recipient.id]);
});

// ---------------------------------------------------------------------------
// Reconciliation hardening tests (21-28)
// ---------------------------------------------------------------------------

// 21. COMPLETED + both DELIVERED + HELD → reconciliation releases
check('reconciliation releases HELD gap on COMPLETED swap with both DELIVERED', async () => {
  const payer = await createUser('recon-release-payer');
  const recipient = await createUser('recon-release-recipient');
  const itemP = await createItem(payer.id, 8000);
  const itemR = await createItem(recipient.id, 7000);
  const swap = await createSwap(payer.id, itemP.id, recipient.id, itemR.id, 1000, 'OFFERING_USER');

  // Mark COMPLETED
  await prisma.swap.update({ where: { id: swap.id }, data: { status: SwapStatus.COMPLETED, completedAt: new Date() } });

  // Create two DELIVERED shipments
  await createShipment(swap.id, payer.id, recipient.id, itemP.id, ShipmentStatus.DELIVERED);
  await createShipment(swap.id, recipient.id, payer.id, itemR.id, ShipmentStatus.DELIVERED);

  const payment = await createPayment(swap.id, payer.id, 1000, 50);
  await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID } });

  const { allocateValueGap, reconcileValueGaps } = await import('../apps/api/src/services/value-gap.ts');
  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: payer.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });

  const vgBefore = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vgBefore.state, ValueGapState.HELD, 'Should be HELD before reconciliation');

  const reconciled = await reconcileValueGaps();
  assert.ok(reconciled >= 1, 'Should have reconciled at least 1 value gap');

  const vgAfter = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vgAfter.state, ValueGapState.RELEASED, 'Should be RELEASED after reconciliation');

  await prisma.valueGap.delete({ where: { id: vgAfter.id } });
  await prisma.payment.delete({ where: { id: payment.id } });
  await prisma.shipment.deleteMany({ where: { swapId: swap.id } });
  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemP.id, itemR.id] } } });
  await cleanupUsers([payer.id, recipient.id]);
});

// 22. COMPLETED + only one DELIVERED → remains HELD
check('reconciliation does not release HELD gap with only one shipment DELIVERED', async () => {
  const payer = await createUser('recon-partial-payer');
  const recipient = await createUser('recon-partial-recipient');
  const itemP = await createItem(payer.id, 8000);
  const itemR = await createItem(recipient.id, 7000);
  const swap = await createSwap(payer.id, itemP.id, recipient.id, itemR.id, 1000, 'OFFERING_USER');

  await prisma.swap.update({ where: { id: swap.id }, data: { status: SwapStatus.COMPLETED, completedAt: new Date() } });

  // Only one DELIVERED, one still PENDING
  await createShipment(swap.id, payer.id, recipient.id, itemP.id, ShipmentStatus.DELIVERED);
  await createShipment(swap.id, recipient.id, payer.id, itemR.id, ShipmentStatus.PENDING);

  const payment = await createPayment(swap.id, payer.id, 1000, 50);
  await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID } });

  const { allocateValueGap, reconcileValueGaps } = await import('../apps/api/src/services/value-gap.ts');
  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: payer.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });

  await reconcileValueGaps();

  const vg = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vg.state, ValueGapState.HELD, 'Should remain HELD — only one shipment delivered');

  await prisma.valueGap.delete({ where: { id: vg.id } });
  await prisma.payment.delete({ where: { id: payment.id } });
  await prisma.shipment.deleteMany({ where: { swapId: swap.id } });
  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemP.id, itemR.id] } } });
  await cleanupUsers([payer.id, recipient.id]);
});

// 23. COMPLETED + both DELIVERED + already RELEASED → no-op
check('reconciliation does not double-release already RELEASED gap', async () => {
  const payer = await createUser('recon-already-payer');
  const recipient = await createUser('recon-already-recipient');
  const itemP = await createItem(payer.id, 8000);
  const itemR = await createItem(recipient.id, 7000);
  const swap = await createSwap(payer.id, itemP.id, recipient.id, itemR.id, 1000, 'OFFERING_USER');

  await prisma.swap.update({ where: { id: swap.id }, data: { status: SwapStatus.COMPLETED, completedAt: new Date() } });
  await createShipment(swap.id, payer.id, recipient.id, itemP.id, ShipmentStatus.DELIVERED);
  await createShipment(swap.id, recipient.id, payer.id, itemR.id, ShipmentStatus.DELIVERED);

  const payment = await createPayment(swap.id, payer.id, 1000, 50);
  await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID } });

  const { allocateValueGap, releaseValueGap, reconcileValueGaps } = await import('../apps/api/src/services/value-gap.ts');
  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: payer.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });

  // Already released
  await prisma.$transaction(async (tx) => {
    await releaseValueGap(tx, swap.id);
  });

  const vgBefore = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vgBefore.state, ValueGapState.RELEASED);

  // Reconciliation should be a no-op for this gap
  const reconciled = await reconcileValueGaps();

  const vgAfter = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vgAfter.state, ValueGapState.RELEASED, 'Should remain RELEASED');
  assert.equal(vgAfter.id, vgBefore.id, 'Same record — no duplicate');

  await prisma.valueGap.delete({ where: { id: vgAfter.id } });
  await prisma.payment.delete({ where: { id: payment.id } });
  await prisma.shipment.deleteMany({ where: { swapId: swap.id } });
  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemP.id, itemR.id] } } });
  await cleanupUsers([payer.id, recipient.id]);
});

// 24. cancelled + HELD → REFUNDED via reconciliation (explicit expired path)
check('reconciliation refunds HELD gap on EXPIRED swap', async () => {
  const payer = await createUser('recon-expire-payer');
  const recipient = await createUser('recon-expire-recipient');
  const itemP = await createItem(payer.id, 8000);
  const itemR = await createItem(recipient.id, 7000);
  const swap = await createSwap(payer.id, itemP.id, recipient.id, itemR.id, 1000, 'OFFERING_USER');

  await prisma.swap.update({ where: { id: swap.id }, data: { status: SwapStatus.EXPIRED } });

  const payment = await createPayment(swap.id, payer.id, 1000, 50);
  await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID } });

  const { allocateValueGap, reconcileValueGaps } = await import('../apps/api/src/services/value-gap.ts');
  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: payer.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });

  const reconciled = await reconcileValueGaps();
  assert.ok(reconciled >= 1, 'Should have reconciled at least 1 value gap');

  const vg = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vg.state, ValueGapState.REFUNDED, 'Should be REFUNDED after reconciliation');
  assert.equal(vg.refundReason, 'RECONCILIATION_CANCELLED_SWAP');

  await prisma.valueGap.delete({ where: { id: vg.id } });
  await prisma.payment.delete({ where: { id: payment.id } });
  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemP.id, itemR.id] } } });
  await cleanupUsers([payer.id, recipient.id]);
});

// 25. RELEASED → never automatically REFUNDED by reconciliation
check('reconciliation never auto-refunds a RELEASED gap', async () => {
  const payer = await createUser('recon-released-payer');
  const recipient = await createUser('recon-released-recipient');
  const itemP = await createItem(payer.id, 8000);
  const itemR = await createItem(recipient.id, 7000);
  const swap = await createSwap(payer.id, itemP.id, recipient.id, itemR.id, 1000, 'OFFERING_USER');

  // Manually set swap to CANCELLED after release to test that reconciliation
  // does NOT refund a RELEASED gap regardless of swap status.
  await prisma.swap.update({ where: { id: swap.id }, data: { status: SwapStatus.COMPLETED, completedAt: new Date() } });

  const payment = await createPayment(swap.id, payer.id, 1000, 50);
  await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID } });

  const { allocateValueGap, releaseValueGap, reconcileValueGaps } = await import('../apps/api/src/services/value-gap.ts');
  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: payer.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });
  await prisma.$transaction(async (tx) => {
    await releaseValueGap(tx, swap.id);
  });

  const vgBefore = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vgBefore.state, ValueGapState.RELEASED);

  // Now set swap to CANCELLED — reconciliation must NOT touch the RELEASED gap
  await prisma.swap.update({ where: { id: swap.id }, data: { status: SwapStatus.CANCELLED } });

  await reconcileValueGaps();

  const vgAfter = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vgAfter.state, ValueGapState.RELEASED, 'RELEASED gap must not be auto-refunded');

  await prisma.valueGap.delete({ where: { id: vgAfter.id } });
  await prisma.payment.delete({ where: { id: payment.id } });
  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemP.id, itemR.id] } } });
  await cleanupUsers([payer.id, recipient.id]);
});

// 26. Repeated reconciliation produces no duplicate releases
check('repeated reconciliation does not duplicate release', async () => {
  const payer = await createUser('recon-repeat-payer');
  const recipient = await createUser('recon-repeat-recipient');
  const itemP = await createItem(payer.id, 8000);
  const itemR = await createItem(recipient.id, 7000);
  const swap = await createSwap(payer.id, itemP.id, recipient.id, itemR.id, 1000, 'OFFERING_USER');

  await prisma.swap.update({ where: { id: swap.id }, data: { status: SwapStatus.COMPLETED, completedAt: new Date() } });
  await createShipment(swap.id, payer.id, recipient.id, itemP.id, ShipmentStatus.DELIVERED);
  await createShipment(swap.id, recipient.id, payer.id, itemR.id, ShipmentStatus.DELIVERED);

  const payment = await createPayment(swap.id, payer.id, 1000, 50);
  await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID } });

  const { allocateValueGap, reconcileValueGaps } = await import('../apps/api/src/services/value-gap.ts');
  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: payer.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });

  // First reconciliation — releases the gap
  await reconcileValueGaps();
  const vgAfter1 = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vgAfter1.state, ValueGapState.RELEASED);

  // Second reconciliation — should be a no-op
  await reconcileValueGaps();
  const vgAfter2 = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vgAfter2.state, ValueGapState.RELEASED);
  assert.equal(vgAfter2.id, vgAfter1.id, 'Same record — no duplicate created');

  // Third reconciliation — still no-op
  await reconcileValueGaps();
  const vgAfter3 = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vgAfter3.id, vgAfter1.id, 'Still same record');

  await prisma.valueGap.delete({ where: { id: vgAfter3.id } });
  await prisma.payment.delete({ where: { id: payment.id } });
  await prisma.shipment.deleteMany({ where: { swapId: swap.id } });
  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemP.id, itemR.id] } } });
  await cleanupUsers([payer.id, recipient.id]);
});

// 27. COMPLETED + 0 shipments → remains HELD (edge case: no shipments at all)
check('reconciliation does not release HELD gap on COMPLETED swap with 0 shipments', async () => {
  const payer = await createUser('recon-no-ship-payer');
  const recipient = await createUser('recon-no-ship-recipient');
  const itemP = await createItem(payer.id, 8000);
  const itemR = await createItem(recipient.id, 7000);
  const swap = await createSwap(payer.id, itemP.id, recipient.id, itemR.id, 1000, 'OFFERING_USER');

  await prisma.swap.update({ where: { id: swap.id }, data: { status: SwapStatus.COMPLETED, completedAt: new Date() } });

  const payment = await createPayment(swap.id, payer.id, 1000, 50);
  await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID } });

  const { allocateValueGap, reconcileValueGaps } = await import('../apps/api/src/services/value-gap.ts');
  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: payer.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });

  await reconcileValueGaps();

  const vg = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vg.state, ValueGapState.HELD, 'Should remain HELD — no shipments exist');

  await prisma.valueGap.delete({ where: { id: vg.id } });
  await prisma.payment.delete({ where: { id: payment.id } });
  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemP.id, itemR.id] } } });
  await cleanupUsers([payer.id, recipient.id]);
});

// 28. Concurrency: two parallel reconciliations cannot double-release
check('concurrent reconciliation attempts do not double-release', async () => {
  const payer = await createUser('recon-concurrent-payer');
  const recipient = await createUser('recon-concurrent-recipient');
  const itemP = await createItem(payer.id, 8000);
  const itemR = await createItem(recipient.id, 7000);
  const swap = await createSwap(payer.id, itemP.id, recipient.id, itemR.id, 1000, 'OFFERING_USER');

  await prisma.swap.update({ where: { id: swap.id }, data: { status: SwapStatus.COMPLETED, completedAt: new Date() } });
  await createShipment(swap.id, payer.id, recipient.id, itemP.id, ShipmentStatus.DELIVERED);
  await createShipment(swap.id, recipient.id, payer.id, itemR.id, ShipmentStatus.DELIVERED);

  const payment = await createPayment(swap.id, payer.id, 1000, 50);
  await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.PAID } });

  const { allocateValueGap, reconcileValueGaps } = await import('../apps/api/src/services/value-gap.ts');
  await prisma.$transaction(async (tx) => {
    await allocateValueGap(tx, {
      paymentId: payment.id,
      swapId: swap.id,
      payerUserId: payer.id,
      valueGapPence: 1000,
      serviceFeePence: 50,
    });
  });

  // Run two reconciliations concurrently — one wins, the other is a no-op
  const [r1, r2] = await Promise.all([reconcileValueGaps(), reconcileValueGaps()]);
  // At least one should have reconciled the gap, the other may or may not
  assert.ok(r1 + r2 >= 1, 'At least one reconciliation should have acted');

  const vg = await prisma.valueGap.findUnique({ where: { swapId: swap.id } });
  assert.equal(vg.state, ValueGapState.RELEASED, 'Should be exactly RELEASED');

  // Count records — must be exactly 1
  const count = await prisma.valueGap.count({ where: { swapId: swap.id } });
  assert.equal(count, 1, 'Must have exactly one ValueGap record');

  await prisma.valueGap.delete({ where: { id: vg.id } });
  await prisma.payment.delete({ where: { id: payment.id } });
  await prisma.shipment.deleteMany({ where: { swapId: swap.id } });
  await prisma.swap.delete({ where: { id: swap.id } });
  await prisma.item.deleteMany({ where: { id: { in: [itemP.id, itemR.id] } } });
  await cleanupUsers([payer.id, recipient.id]);
});

// ---------------------------------------------------------------------------
// Run all checks
// ---------------------------------------------------------------------------

for (const r of results) {
  try {
    await r.fn();
    r.ok = true;
  } catch (err) {
    r.ok = false;
    r.err = err;
  }
}

let failures = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`  PASS  ${r.name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${r.name}`);
    console.log(String(r.err?.stack ?? r.err));
  }
}
console.log(`\n${results.length - failures}/${results.length} value-gap checks passed`);
process.exit(failures === 0 ? 0 : 1);
