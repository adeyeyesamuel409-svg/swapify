// R14 offline verification: Stripe LIVE/TEST webhook mode gate + observability.
// Run with: npx tsx qa/r14-webhook-mode-gate.test.mjs
//
// Fully OFFLINE. Drives the REAL audited handler in-process via
// fastify.inject() against a throwaway local Postgres (127.0.0.1:15443, the R12
// container). No sockets, no production resources, and NO outbound Stripe call:
// an egress guard is armed on both global fetch and the cached Stripe client.
//
// The gate under test runs AFTER signature verification and BEFORE any write:
//   * configured mode comes from the STRIPE_SECRET_KEY family (sk_live_/rk_live_
//     => live, sk_test_/rk_test_ => test), optionally asserted by STRIPE_MODE;
//   * event mode comes from the signature-verified event.livemode;
//   * a mismatch (or missing/unknown mode) is acknowledged 200 {received:true}
//     and dropped with zero DB writes, zero Stripe calls.
//
// All credentials are LOCAL THROWAWAY fixtures. The `sk_live_...` strings below
// are synthetic, never real, never sent anywhere, and exist only to make the
// configured-mode resolver return 'live' for the LIVE-branch offline tests.

import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';

const REPO = fileURLToPath(new URL('..', import.meta.url));

// ---------------------------------------------------------------------------
// Phase A — environment safety (local-only, TEST-family base credentials)
// ---------------------------------------------------------------------------
const ENV_FILE =
  process.env.R14_ENV_FILE ??
  join(process.env.TEMP ?? process.env.TMP ?? '/tmp', 'opencode', 'r12-harness', '.r12-env');

const fileEnv = {};
for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i > 0) fileEnv[line.slice(0, i)] = line.slice(i + 1);
}
for (const k of ['DATABASE_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) {
  if (!fileEnv[k]) throw new Error(`R14 ABORT: ${k} missing from ${ENV_FILE}`);
}
if (!fileEnv.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
  throw new Error('R14 ABORT: base key must be a TEST-family key');
}
if (!fileEnv.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')) {
  throw new Error('R14 ABORT: base webhook secret must be a webhook-secret');
}
const dbHost = (fileEnv.DATABASE_URL.match(/@([^:@/]+)[:/]?/) ?? [])[1];
if (!['127.0.0.1', 'localhost', '::1'].includes(dbHost)) {
  throw new Error(`R14 ABORT: DATABASE_URL host "${dbHost}" is not localhost`);
}
if (!fileEnv.DATABASE_URL.includes(':15443/')) {
  throw new Error('R14 ABORT: DATABASE_URL is not the throwaway DB on port 15443');
}

const WEBHOOK_SECRET = fileEnv.STRIPE_WEBHOOK_SECRET;
const TEST_KEY = fileEnv.STRIPE_SECRET_KEY; // sk_test_... (base)
const LIVE_KEY = 'sk_live_R14_offline_fixture_never_used'; // synthetic, offline-only

Object.assign(process.env, {
  NODE_ENV: 'production',
  APP_ROLE: 'api',
  RECONCILE_IN_PROCESS: 'false',
  WEB_BASE_URL: 'https://r14-test.invalid',
  LOG_LEVEL: 'info',
  STORAGE_DRIVER: 'local',
  UPLOAD_DIR: join(REPO, 'qa', '.r14-uploads'),
  COGNITO_REGION: 'us-east-1',
  COGNITO_USER_POOL_ID: 'r14-offline',
  COGNITO_CLIENT_ID: 'r14-offline',
  S3_BUCKET: 'unused-local',
  CDN_BASE_URL: 'https://r14-test.invalid',
  DATABASE_URL: fileEnv.DATABASE_URL,
  STRIPE_SECRET_KEY: TEST_KEY,
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
});

// ---------------------------------------------------------------------------
// Egress guard — any Stripe network call fails the suite loudly
// ---------------------------------------------------------------------------
const originalFetch = globalThis.fetch;
globalThis.fetch = ((url, init) => {
  if (/api\.stripe\.com/.test(String(url))) {
    throw new Error('EGRESS GUARD: outbound call to api.stripe.com attempted');
  }
  return originalFetch ? originalFetch(url, init) : Promise.reject(new Error('no fetch'));
});

const prisma = new PrismaClient({ log: ['error'] });

// Defensive pre-clean of any orphaned rows from a previous interrupted run.
for (const u of await prisma.user.findMany({
  where: { OR: [{ name: 'R14 Buyer' }, { name: 'R14 Seller' }] },
  select: { id: true },
})) {
  const swaps = await prisma.swap.findMany({
    where: { OR: [{ offeringUserId: u.id }, { requestedUserId: u.id }] },
    select: { id: true },
  });
  const payments = await prisma.payment.findMany({ where: { swapId: { in: swaps.map((s) => s.id) } }, select: { id: true } });
  await prisma.shipment.deleteMany({ where: { swapId: { in: swaps.map((s) => s.id) } } });
  await prisma.valueGap.deleteMany({ where: { paymentId: { in: payments.map((p) => p.id) } } });
  await prisma.payment.deleteMany({ where: { id: { in: payments.map((p) => p.id) } } });
  await prisma.swap.deleteMany({ where: { id: { in: swaps.map((s) => s.id) } } });
  await prisma.item.deleteMany({ where: { ownerId: u.id } });
  await prisma.notification.deleteMany({ where: { userId: u.id } });
  await prisma.user.deleteMany({ where: { id: u.id } });
}

// ---------------------------------------------------------------------------
// Result harness
// ---------------------------------------------------------------------------
const results = [];
async function check(id, label, fn) {
  try {
    await fn();
    results.push({ id, label, ok: true });
    console.log(`[PASS] ${id} ${label}`);
  } catch (err) {
    results.push({ id, label, ok: false, err });
    console.log(`[FAIL] ${id} ${label}\n       ${err?.message ?? err}`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------
function signPayload(payload, secret = WEBHOOK_SECRET) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

function makeEvent(type, object, livemode = false) {
  const ev = {
    id: `evt_test_r14_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    object: 'event',
    api_version: '2026-07-29.dahlia',
    created: Math.floor(Date.now() / 1000),
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: { object },
  };
  if (livemode !== undefined) ev.livemode = livemode;
  return ev;
}

const FIN_TABLES = [
  'Payment', 'Swap', 'ValueGap', 'Withdrawal', 'BalanceAccount',
  'BalanceEntry', 'ConnectedAccount', 'PayoutMethod', 'Shipment',
];
async function finCounts() {
  const out = {};
  for (const t of FIN_TABLES) {
    const r = await prisma.$queryRawUnsafe(`SELECT count(*)::bigint AS c FROM "${t}"`);
    out[t] = Number(r[0].c);
  }
  return out;
}
function finDiff(a, b) {
  const changed = [];
  for (const k of FIN_TABLES) if (b[k] !== a[k]) changed.push(`${k}:${a[k]}->${b[k]}`);
  return changed.length ? changed.join(', ') : '(unchanged)';
}

// Seed an AGREED value-gap swap that markPaymentPaid can advance to PAID.
const seeded = { users: [], items: [], swaps: [], payments: [] };
async function seedAgreedSwapPayment(gapPence) {
  const buyer = await prisma.user.create({
    data: { email: `r14-buyer-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`, name: 'R14 Buyer' },
  });
  const seller = await prisma.user.create({
    data: { email: `r14-seller-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`, name: 'R14 Seller' },
  });
  const buyerItem = await prisma.item.create({
    data: { ownerId: buyer.id, title: 'R14 A', description: 'x', category: 'ELECTRONICS', condition: 'GOOD', valuePence: 10000 },
  });
  const sellerItem = await prisma.item.create({
    data: { ownerId: seller.id, title: 'R14 B', description: 'x', category: 'ELECTRONICS', condition: 'GOOD', valuePence: 10000 - gapPence },
  });
  const swap = await prisma.swap.create({
    data: {
      offeringUserId: buyer.id, offeringItemId: buyerItem.id,
      requestedUserId: seller.id, requestedItemId: sellerItem.id,
      gapPence, gapPayer: 'OFFERING_USER', status: 'AGREED',
      expiresAt: new Date(Date.now() + 3 * 86400000),
    },
  });
  const feePence = Math.round(gapPence * 0.05);
  const payment = await prisma.payment.create({
    data: { swapId: swap.id, payerUserId: buyer.id, amountPence: gapPence, feePence, totalPence: gapPence + feePence, status: 'PENDING' },
  });
  seeded.users.push(buyer.id, seller.id);
  seeded.items.push(buyerItem.id, sellerItem.id);
  seeded.swaps.push(swap.id);
  seeded.payments.push(payment.id);
  return { swap, payment };
}

// ---------------------------------------------------------------------------
// Boot the REAL app and arm the Stripe client egress guard
// ---------------------------------------------------------------------------
const { buildApp } = await import(pathToFileURL(join(REPO, 'apps/api/src/app.ts')).href);
const { getStripe } = await import(pathToFileURL(join(REPO, 'apps/api/src/services/stripe.ts')).href);
const { resolveStripeMode, validateStripeModeConfig, eventMatchesMode, stripeKeyModeFamily } =
  await import(pathToFileURL(join(REPO, 'apps/api/src/services/stripe-mode.ts')).href);
const { logWebhook } = await import(pathToFileURL(join(REPO, 'apps/api/src/services/webhook-observability.ts')).href);

const app = await buildApp();
await app.ready();

const stripeClient = getStripe();
stripeClient.request = () => {
  throw new Error('EGRESS GUARD: Stripe client.request() called during offline test');
};

async function post(ev, { signature, mode, key } = {}) {
  const prevKey = process.env.STRIPE_SECRET_KEY;
  const prevMode = process.env.STRIPE_MODE;
  if (key !== undefined) process.env.STRIPE_SECRET_KEY = key;
  if (mode !== undefined) process.env.STRIPE_MODE = mode;
  try {
    const payload = JSON.stringify(ev);
    const sig = signature === undefined ? signPayload(payload) : signature;
    const headers = { 'content-type': 'application/json' };
    if (sig !== null) headers['stripe-signature'] = sig;
    return await app.inject({ method: 'POST', url: '/stripe/webhook', headers, payload });
  } finally {
    if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = prevKey;
    if (prevMode === undefined) delete process.env.STRIPE_MODE; else process.env.STRIPE_MODE = prevMode;
  }
}

// ===========================================================================
// Unit: configured-mode resolution (no DB, no HTTP)
// ===========================================================================
await check('N1', 'key-family resolver + STRIPE_MODE agreement/contradiction', () => {
  assert.equal(stripeKeyModeFamily('sk_live_x'), 'live');
  assert.equal(stripeKeyModeFamily('rk_live_x'), 'live');
  assert.equal(stripeKeyModeFamily('sk_test_x'), 'test');
  assert.equal(stripeKeyModeFamily('rk_test_x'), 'test');
  assert.equal(stripeKeyModeFamily('pk_live_x'), null);
  assert.equal(stripeKeyModeFamily(undefined), null);

  assert.equal(resolveStripeMode({ STRIPE_SECRET_KEY: 'sk_live_x' }), 'live');
  assert.equal(resolveStripeMode({ STRIPE_SECRET_KEY: 'sk_test_x' }), 'test');
  assert.equal(resolveStripeMode({}), 'unknown');
  assert.equal(resolveStripeMode({ STRIPE_SECRET_KEY: 'pk_live_x' }), 'unknown');
  assert.equal(resolveStripeMode({ STRIPE_MODE: 'live', STRIPE_SECRET_KEY: 'sk_live_x' }), 'live');
  assert.throws(() => resolveStripeMode({ STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'sk_live_x' }), /contradicts/);
  assert.throws(() => resolveStripeMode({ STRIPE_MODE: 'sandbox' }), /invalid/);
});

await check('N2', 'startup validation: production never defaults to LIVE', () => {
  // production + no key => cannot determine mode => fatal
  assert.throws(() => validateStripeModeConfig({ NODE_ENV: 'production' }), /never default to LIVE/);
  // production + unrecognized key family => fatal
  assert.throws(
    () => validateStripeModeConfig({ NODE_ENV: 'production', STRIPE_SECRET_KEY: 'pk_live_x' }),
    /unrecognized/,
  );
  // production + recognized TEST key => OK (preserves prod-arch.test.mjs expectation)
  assert.doesNotThrow(() => validateStripeModeConfig({ NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_x' }));
  // production + recognized LIVE key => OK
  assert.doesNotThrow(() => validateStripeModeConfig({ NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_live_x' }));
  // dev + no key => tolerated (gate still fails closed at request time)
  assert.doesNotThrow(() => validateStripeModeConfig({}));
});

await check('N3', 'admission matrix: missing/unknown mode is fail-closed', () => {
  assert.equal(eventMatchesMode({ livemode: false }, 'test'), true);
  assert.equal(eventMatchesMode({ livemode: true }, 'live'), true);
  assert.equal(eventMatchesMode({ livemode: true }, 'test'), false);
  assert.equal(eventMatchesMode({ livemode: false }, 'live'), false);
  assert.equal(eventMatchesMode({}, 'test'), false);
  assert.equal(eventMatchesMode({}, 'live'), false);
  assert.equal(eventMatchesMode({ livemode: false }, 'unknown'), false);
  assert.equal(eventMatchesMode({ livemode: true }, 'unknown'), false);
});

// ===========================================================================
// Observability privacy (no secrets / raw bodies / signatures in logs)
// ===========================================================================
await check('N10a', 'logWebhook output is field-whitelisted (no payload/signature leak)', () => {
  const captured = [];
  const fakeReq = {
    id: 'r14-corr-id',
    log: { info: (o) => captured.push(o), warn: (o) => captured.push(o), error: (o) => captured.push(o) },
  };
  logWebhook(fakeReq, 'signature_failed', {
    errName: 'StripeSignatureVerificationError',
    // Deliberately attempt to smuggle sensitive fields; they must be dropped.
    payload: 'SENSITIVE_RAW_BODY',
    header: 'whsec_SENSITIVE',
    signature: 't=1,v1=SENSITIVE',
  });
  assert.equal(captured.length, 1);
  const dumped = JSON.stringify(captured[0]);
  assert.ok(!/SENSITIVE/.test(dumped), 'sensitive fields must never appear in logs');
  assert.ok(!/whsec/.test(dumped), 'webhook secret must never appear in logs');
  const allowed = new Set(['event', 'corrId', 'eventId', 'eventType', 'livemode', 'mode', 'outcome', 'httpStatus', 'errName']);
  for (const k of Object.keys(captured[0])) assert.ok(allowed.has(k), `unexpected log field: ${k}`);
});

await check('N10b', 'signature-failure path no longer logs the error object (leak fix)', () => {
  const src = readFileSync(join(REPO, 'apps/api/src/routes/stripe.ts'), 'utf8');
  assert.ok(!/log\.warn\(err\s*,/.test(src), 'routes must not log the raw Stripe signature error');
  assert.ok(/logWebhook\(request, 'signature_failed'/.test(src), 'sanitized signature failure logging present');
});

// ===========================================================================
// HTTP integration — signature handling (regression)
// ===========================================================================
await check('N9', 'missing signature -> 400, no writes', async () => {
  const before = await finCounts();
  const ev = makeEvent('balance.available', { id: 'ba_r14_0', object: 'balance' }, false);
  const res = await post(ev, { signature: null });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(JSON.parse(res.body), { error: 'Missing Stripe signature' });
  assert.equal(finDiff(before, await finCounts()), '(unchanged)');
});

await check('N9b', 'invalid signature -> 400 "Invalid signature", no writes', async () => {
  const before = await finCounts();
  const ev = makeEvent('checkout.session.completed', {
    id: 'cs_test_r14_bad', object: 'checkout.session', metadata: { paymentId: 'pmt_r14_x' }, payment_intent: 'pi_r14_x',
  }, false);
  const res = await post(ev, { signature: signPayload(JSON.stringify(ev), 'whsec_test_wrong_' + 'a'.repeat(20)) });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(JSON.parse(res.body), { error: 'Invalid signature' });
  assert.equal(finDiff(before, await finCounts()), '(unchanged)');
});

// ===========================================================================
// HTTP integration — mode gate (the R14 hazard)
// ===========================================================================

// Positive control: same-mode TEST event with TEST config is admitted and writes.
let admittedTestPayment;
await check('N4', 'TEST config + TEST event -> admitted and processed (control)', async () => {
  const { swap, payment } = await seedAgreedSwapPayment(5000);
  admittedTestPayment = payment;
  const ev = makeEvent('checkout.session.completed', {
    id: 'cs_test_r14_ok', object: 'checkout.session',
    metadata: { paymentId: payment.id, swapId: swap.id }, payment_status: 'paid', payment_intent: 'pi_r14_ok',
  }, false);
  const res = await post(ev, { key: TEST_KEY, mode: 'test' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { received: true });
  const p = await prisma.payment.findUnique({ where: { id: payment.id } });
  assert.equal(p.status, 'PAID');
  const s = await prisma.swap.findUnique({ where: { id: swap.id } });
  assert.equal(s.status, 'PAID');
  const vg = await prisma.valueGap.findUnique({ where: { paymentId: payment.id } });
  assert.ok(vg && vg.state === 'HELD');
  assert.equal(await prisma.shipment.count({ where: { swapId: swap.id } }), 2);
});

// CORE HAZARD: TEST event delivered to LIVE-configured deployment is dropped.
let liveAttemptPayment;
await check('N6', 'LIVE config + TEST event -> rejected, 200 ack, ZERO writes', async () => {
  const { swap, payment } = await seedAgreedSwapPayment(5000);
  liveAttemptPayment = payment;
  const before = await finCounts();
  const ev = makeEvent('checkout.session.completed', {
    id: 'cs_test_r14_into_live', object: 'checkout.session',
    metadata: { paymentId: payment.id, swapId: swap.id }, payment_status: 'paid', payment_intent: 'pi_r14_into_live',
  }, false); // livemode:false == TEST event
  const res = await post(ev, { key: LIVE_KEY, mode: 'live' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { received: true });
  const p = await prisma.payment.findUnique({ where: { id: payment.id } });
  assert.equal(p.status, 'PENDING', 'mis-moded event must not mutate the payment');
  const s = await prisma.swap.findUnique({ where: { id: swap.id } });
  assert.equal(s.status, 'AGREED');
  assert.equal(await prisma.valueGap.count({ where: { paymentId: payment.id } }), 0);
  assert.equal(await prisma.shipment.count({ where: { swapId: swap.id } }), 0);
  assert.equal(finDiff(before, await finCounts()), '(unchanged)');
});

// Reverse direction: LIVE event into TEST-configured deployment is dropped.
await check('N5', 'TEST config + LIVE event -> rejected, 200 ack, ZERO writes', async () => {
  const { swap, payment } = await seedAgreedSwapPayment(5000);
  const before = await finCounts();
  const ev = makeEvent('checkout.session.completed', {
    id: 'cs_live_r14_into_test', object: 'checkout.session',
    metadata: { paymentId: payment.id, swapId: swap.id }, payment_status: 'paid', payment_intent: 'pi_r14_into_test',
  }, true); // livemode:true == LIVE event
  const res = await post(ev, { key: TEST_KEY, mode: 'test' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { received: true });
  assert.equal((await prisma.payment.findUnique({ where: { id: payment.id } })).status, 'PENDING');
  assert.equal(finDiff(before, await finCounts()), '(unchanged)');
});

// Positive LIVE control: same-mode LIVE event is admitted and writes.
await check('N7', 'LIVE config + LIVE event -> admitted and processed (control)', async () => {
  const { swap, payment } = await seedAgreedSwapPayment(4000);
  const ev = makeEvent('checkout.session.completed', {
    id: 'cs_live_r14_ok', object: 'checkout.session',
    metadata: { paymentId: payment.id, swapId: swap.id }, payment_status: 'paid', payment_intent: 'pi_r14_live_ok',
  }, true);
  const res = await post(ev, { key: LIVE_KEY, mode: 'live' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { received: true });
  assert.equal((await prisma.payment.findUnique({ where: { id: payment.id } })).status, 'PAID');
  assert.ok(await prisma.valueGap.findUnique({ where: { paymentId: payment.id } }));
});

// Fail-closed: an event with no livemode is rejected even under matching family.
await check('N8', 'missing livemode -> fail-closed rejection, no writes', async () => {
  const { payment } = await seedAgreedSwapPayment(3000);
  const before = await finCounts();
  const ev = makeEvent('checkout.session.completed', {
    id: 'cs_test_r14_nomode', object: 'checkout.session',
    metadata: { paymentId: payment.id }, payment_status: 'paid', payment_intent: 'pi_r14_nomode',
  }, undefined);
  delete ev.livemode;
  const res = await post(ev, { key: TEST_KEY, mode: 'test' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { received: true });
  assert.equal((await prisma.payment.findUnique({ where: { id: payment.id } })).status, 'PENDING');
  assert.equal(finDiff(before, await finCounts()), '(unchanged)');
});

// Fail-closed: an invalid STRIPE_MODE at request time is a 500, never a write.
await check('N8b', 'invalid STRIPE_MODE -> fail-closed 500, no writes', async () => {
  const { payment } = await seedAgreedSwapPayment(2000);
  const before = await finCounts();
  const ev = makeEvent('checkout.session.completed', {
    id: 'cs_test_r14_badmode', object: 'checkout.session',
    metadata: { paymentId: payment.id }, payment_status: 'paid', payment_intent: 'pi_r14_badmode',
  }, false);
  const res = await post(ev, { key: TEST_KEY, mode: 'sandbox' });
  assert.equal(res.statusCode, 500);
  assert.equal((await prisma.payment.findUnique({ where: { id: payment.id } })).status, 'PENDING');
  assert.equal(finDiff(before, await finCounts()), '(unchanged)');
});

// Duplicate admitted delivery is idempotent (no second ValueGap/shipment/balance).
await check('N11', 'duplicate admitted delivery is idempotent', async () => {
  const { swap, payment } = await seedAgreedSwapPayment(5000);
  const baBefore = await prisma.balanceEntry.count();
  const ev = makeEvent('checkout.session.completed', {
    id: 'cs_test_r14_dup', object: 'checkout.session',
    metadata: { paymentId: payment.id, swapId: swap.id }, payment_status: 'paid', payment_intent: 'pi_r14_dup',
  }, false);
  const r1 = await post(ev, { key: TEST_KEY, mode: 'test' });
  const r2 = await post(ev, { key: TEST_KEY, mode: 'test' }); // same session id, redelivery
  assert.equal(r1.statusCode, 200);
  assert.equal(r2.statusCode, 200);
  assert.equal(await prisma.valueGap.count({ where: { paymentId: payment.id } }), 1);
  assert.equal(await prisma.shipment.count({ where: { swapId: swap.id } }), 2);
  assert.equal(await prisma.balanceEntry.count(), baBefore);
});

// Unsupported / log-only events admitted write nothing; wrong-mode dispute cannot
// reach refund logic; right-mode dispute is durably captured (observation only).
await check('N12', 'unsupported no-op + dispute clawback isolation by mode', async () => {
  const before = await finCounts();

  // admitted log-only event -> 200, nothing written
  const t = makeEvent('transfer.updated', { id: 'tr_r14_1', object: 'transfer', amount: 1000, currency: 'gbp' }, false);
  assert.equal((await post(t, { key: TEST_KEY, mode: 'test' })).statusCode, 200);

  // dispute delivered in the WRONG mode must be rejected before any record
  const dispEvtId = `evt_test_r14_disp_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const disp = makeEvent('charge.dispute.created', {
    id: 'dp_r14_1', object: 'dispute', amount: 1234, currency: 'gbp',
    status: 'needs_response', reason: 'fraudulent', payment_intent: 'pi_r14_dispute',
  }, false);
  disp.id = dispEvtId;
  assert.equal((await post(disp, { key: LIVE_KEY, mode: 'live' })).statusCode, 200);
  assert.equal(await prisma.disputeEventObservation.count({ where: { stripeEventId: dispEvtId } }), 0);

  // same dispute admitted in the correct mode -> observation captured, no refund
  assert.equal((await post(disp, { key: TEST_KEY, mode: 'test' })).statusCode, 200);
  assert.equal(await prisma.disputeEventObservation.count({ where: { stripeEventId: dispEvtId } }), 1);

  const refunded = await prisma.payment.count({ where: { OR: [{ refundedAt: { not: null } }, { stripeRefundId: { not: null } }] } });
  assert.equal(refunded, 0, 'a dispute must never write refund fields');

  const after = await finCounts();
  // Only allowed change across these: none in financial tables.
  assert.equal(finDiff(before, after), '(unchanged)');
});

// ---------------------------------------------------------------------------
// Reconcile: cross-mode state structurally cannot exist. Tidy up + report.
// ---------------------------------------------------------------------------
await check('N13', 'reconciler safety: no mis-moded financial rows were ever written', async () => {
  const p = await prisma.payment.findUnique({ where: { id: liveAttemptPayment.id } });
  assert.equal(p.status, 'PENDING');
  assert.equal(p.stripePaymentIntentId, null, 'no LIVE intent recorded for a rejected TEST event');
});

// cleanup seeded rows (reverse FK order)
for (const swapId of seeded.swaps) {
  await prisma.shipment.deleteMany({ where: { swapId } });
}
for (const paymentId of seeded.payments) {
  await prisma.valueGap.deleteMany({ where: { paymentId } });
}
await prisma.payment.deleteMany({ where: { id: { in: seeded.payments } } });
await prisma.swap.deleteMany({ where: { id: { in: seeded.swaps } } });
await prisma.item.deleteMany({ where: { id: { in: seeded.items } } });
await prisma.notification.deleteMany({ where: { userId: { in: seeded.users } } });
await prisma.user.deleteMany({ where: { id: { in: seeded.users } } });
await prisma.disputeEventObservation.deleteMany({ where: { stripeEventId: { startsWith: 'evt_test_r14_disp_' } } });

await app.close();
await prisma.$disconnect();

const passed = results.filter((r) => r.ok).length;
console.log(`\nTOTAL: ${results.length} checks, PASS=${passed}, FAIL=${results.length - passed}`);
if (results.some((r) => !r.ok)) process.exitCode = 1;