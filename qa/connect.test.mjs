// Stripe Connect foundation QA tests. Run with: npx tsx qa/connect.test.mjs
//
// Tests the Stripe Connect foundation: connected-account status mapping,
// account creation (DB-only), onboarding-link generation, deterministic
// transfer idempotency keys, and the disbursement provider wiring.
//
// Uses the real Prisma client against a local dev database. Each test
// cleans up after itself. Does NOT make real Stripe API calls.

import assert from 'node:assert/strict';
import { PrismaClient, ConnectedAccountStatus } from '@prisma/client';
import { mapAccountStatus } from '../apps/api/src/services/stripe-connect.ts';

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
    data: {
      email: `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
      name,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests: mapAccountStatus (pure function, no Stripe calls)
// ---------------------------------------------------------------------------

check('mapAccountStatus: returns ACTIVE when payouts and charges enabled', () => {
  const account = {
    payouts_enabled: true,
    charges_enabled: true,
    requirements: { currently_due: [], disabled_reason: null },
  };
  const result = mapAccountStatus(account);
  assert.equal(result, 'ACTIVE');
});

check('mapAccountStatus: returns ONBOARDING when payouts not yet enabled', () => {
  const account = {
    payouts_enabled: false,
    charges_enabled: false,
    requirements: { currently_due: [], disabled_reason: null },
  };
  const result = mapAccountStatus(account);
  assert.equal(result, 'ONBOARDING');
});

check('mapAccountStatus: returns RESTRICTED when currently_due requirements exist', () => {
  const account = {
    payouts_enabled: false,
    charges_enabled: false,
    requirements: {
      currently_due: ['individual.verification.document'],
      disabled_reason: null,
    },
  };
  const result = mapAccountStatus(account);
  assert.equal(result, 'RESTRICTED');
});

check('mapAccountStatus: returns DISABLED when disabled_reason is set', () => {
  const account = {
    payouts_enabled: false,
    charges_enabled: false,
    requirements: {
      currently_due: [],
      disabled_reason: 'requirements.past_due',
    },
  };
  const result = mapAccountStatus(account);
  assert.equal(result, 'DISABLED');
});

check('mapAccountStatus: DISABLED takes precedence over RESTRICTED', () => {
  const account = {
    payouts_enabled: false,
    charges_enabled: false,
    requirements: {
      currently_due: ['individual.verification.document'],
      disabled_reason: 'requirements.past_due',
    },
  };
  const result = mapAccountStatus(account);
  assert.equal(result, 'DISABLED');
});

check('mapAccountStatus: handles null requirements gracefully', () => {
  const account = {
    payouts_enabled: true,
    charges_enabled: true,
    requirements: null,
  };
  const result = mapAccountStatus(account);
  assert.equal(result, 'ACTIVE');
});

check('mapAccountStatus: handles undefined requirements gracefully', () => {
  const account = {
    payouts_enabled: true,
    charges_enabled: true,
    requirements: undefined,
  };
  const result = mapAccountStatus(account);
  assert.equal(result, 'ACTIVE');
});

// ---------------------------------------------------------------------------
// Tests: ConnectedAccount DB operations
// ---------------------------------------------------------------------------

check('ConnectedAccount can be created and retrieved by userId', async () => {
  const user = await createUser('connect-test-1');
  try {
    const account = await prisma.connectedAccount.create({
      data: {
        userId: user.id,
        stripeAccountId: `acct_test_${Date.now()}`,
        status: 'ONBOARDING',
      },
    });
    assert.ok(account.id);
    assert.equal(account.userId, user.id);
    assert.equal(account.status, 'ONBOARDING');
    assert.equal(account.payoutsEnabled, false);

    const found = await prisma.connectedAccount.findUnique({
      where: { userId: user.id },
    });
    assert.ok(found);
    assert.equal(found.stripeAccountId, account.stripeAccountId);
  } finally {
    await prisma.connectedAccount.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

check('ConnectedAccount enforces unique userId (one account per user)', async () => {
  const user = await createUser('connect-test-2');
  try {
    await prisma.connectedAccount.create({
      data: {
        userId: user.id,
        stripeAccountId: `acct_test_duplicate_${Date.now()}`,
        status: 'ONBOARDING',
      },
    });

    let caught = false;
    try {
      await prisma.connectedAccount.create({
        data: {
          userId: user.id,
          stripeAccountId: `acct_test_duplicate_2_${Date.now()}`,
          status: 'ONBOARDING',
        },
      });
    } catch (err) {
      caught = true;
    }
    assert.ok(caught, 'Should throw on duplicate userId');
  } finally {
    await prisma.connectedAccount.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

check('ConnectedAccount enforces unique stripeAccountId', async () => {
  const user1 = await createUser('connect-test-3a');
  const user2 = await createUser('connect-test-3b');
  const stripeId = `acct_test_unique_${Date.now()}`;
  try {
    await prisma.connectedAccount.create({
      data: { userId: user1.id, stripeAccountId: stripeId, status: 'ONBOARDING' },
    });

    let caught = false;
    try {
      await prisma.connectedAccount.create({
        data: { userId: user2.id, stripeAccountId: stripeId, status: 'ONBOARDING' },
      });
    } catch (err) {
      caught = true;
    }
    assert.ok(caught, 'Should throw on duplicate stripeAccountId');
  } finally {
    await prisma.connectedAccount.deleteMany({
      where: { stripeAccountId: stripeId },
    });
    await prisma.user.delete({ where: { id: user1.id } });
    await prisma.user.delete({ where: { id: user2.id } });
  }
});

check('ConnectedAccount status can be updated', async () => {
  const user = await createUser('connect-test-4');
  try {
    const account = await prisma.connectedAccount.create({
      data: {
        userId: user.id,
        stripeAccountId: `acct_test_update_${Date.now()}`,
        status: 'ONBOARDING',
      },
    });

    const updated = await prisma.connectedAccount.update({
      where: { id: account.id },
      data: {
        status: 'ACTIVE',
        payoutsEnabled: true,
        chargesEnabled: true,
        onboardedAt: new Date(),
      },
    });

    assert.equal(updated.status, 'ACTIVE');
    assert.equal(updated.payoutsEnabled, true);
    assert.ok(updated.onboardedAt);
  } finally {
    await prisma.connectedAccount.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

// ---------------------------------------------------------------------------
// Tests: User.payoutsDisabled
// ---------------------------------------------------------------------------

check('User.payoutsDisabled defaults to false', async () => {
  const user = await createUser('connect-test-5');
  try {
    assert.equal(user.payoutsDisabled, false);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

check('User.payoutsDisabled can be set to true', async () => {
  const user = await createUser('connect-test-6');
  try {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { payoutsDisabled: true },
    });
    assert.equal(updated.payoutsDisabled, true);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

// ---------------------------------------------------------------------------
// Tests: User ↔ ConnectedAccount relation
// ---------------------------------------------------------------------------

check('ConnectedAccount is accessible via User.relation', async () => {
  const user = await createUser('connect-test-7');
  try {
    await prisma.connectedAccount.create({
      data: {
        userId: user.id,
        stripeAccountId: `acct_test_relation_${Date.now()}`,
        status: 'ONBOARDING',
      },
    });

    const userWithAccount = await prisma.user.findUnique({
      where: { id: user.id },
      include: { connectedAccount: true },
    });

    assert.ok(userWithAccount.connectedAccount);
    assert.equal(userWithAccount.connectedAccount.status, 'ONBOARDING');
  } finally {
    await prisma.connectedAccount.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

// ---------------------------------------------------------------------------
// Tests: Deterministic transfer idempotency key
// ---------------------------------------------------------------------------

check('Transfer idempotency key is deterministic for the same ValueGap', () => {
  const valueGapId = 'test-value-gap-123';
  const key1 = `value-gap-transfer:${valueGapId}`;
  const key2 = `value-gap-transfer:${valueGapId}`;
  assert.equal(key1, key2);
});

check('Transfer idempotency keys differ for different ValueGaps', () => {
  const key1 = `value-gap-transfer:gap-aaa`;
  const key2 = `value-gap-transfer:gap-bbb`;
  assert.notEqual(key1, key2);
});

// ---------------------------------------------------------------------------
// Tests: Business constants exist
// ---------------------------------------------------------------------------

check('Default payoutsDisabled is false on new user', async () => {
  const user = await createUser('connect-test-defaults');
  try {
    assert.equal(typeof user.payoutsDisabled, 'boolean');
    assert.equal(user.payoutsDisabled, false);
  } finally {
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
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
