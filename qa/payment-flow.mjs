// Payment-flow integration test: value-gap payments end-to-end against the
// live API. Covers pay gating, service-fee math, simulated checkout,
// markPaymentPaid idempotency (dev-confirm twice + repeat /pay), the
// confirm-before-pay guard, ownership transfer on completion, and the
// cancel-after-pay refund path.
//
// Run after setup-fixtures.mjs against a dev API on :4000 (no Stripe key, so
// the simulated checkout path is exercised).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const API = "http://localhost:4000";
const tmp = path.join(os.tmpdir(), "opencode");
const alice = fs.readFileSync(path.join(tmp, "alice.token"), "utf8").trim();
const mallory = fs.readFileSync(path.join(tmp, "mallory.token"), "utf8").trim();

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://swapify:swapify@localhost:5432/swapify?schema=public";
const { PrismaClient } = await import("@swapify/db");
const prisma = new PrismaClient();

const report = [];
const pass = (m) => report.push("PASS  " + m);
const fail = (m) => report.push("FAIL  " + m);

const j = { "Content-Type": "application/json" };
const auth = (t) => ({ ...j, Authorization: `Bearer ${t}` });
const authNoCT = (t) => ({ Authorization: `Bearer ${t}` });
const post = (t, data) => {
  const opts = { method: "POST", headers: authNoCT(t) };
  if (data) {
    opts.headers = auth(t);
    opts.body = JSON.stringify(data);
  }
  return opts;
};

async function createItem(token, valuePence, title) {
  const r = await fetch(`${API}/items`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({
      title,
      description: "payment-flow fixture.",
      category: "OTHER",
      condition: "GOOD",
      valuePence,
    }),
  });
  if (!r.ok) throw new Error(`fixture create ${r.status}: ${await r.text()}`);
  return (await r.json()).item;
}

async function userId(token) {
  const r = await fetch(`${API}/auth/me`, { headers: auth(token) });
  return (await r.json()).user.id;
}

const [aliceId, malloryId] = await Promise.all([userId(alice), userId(mallory)]);

async function runPaidSwapFlow() {
  report.push("--- Paid swap: gating, payment, idempotency, completion ---");

  // alice offers a cheaper item for mallory's pricier one -> alice pays the gap.
  const offer = await createItem(alice, 200, "payment-flow alice offer");
  const target = await createItem(mallory, 5000, "payment-flow mallory target");

  let r = await fetch(`${API}/swaps`, post(alice, { offeringItemId: offer.id, requestedItemId: target.id }));
  if (!r.ok) throw new Error(`create swap ${r.status}: ${await r.text()}`);
  let swap = (await r.json()).swap;

  if (swap.gapPence === 4800 && swap.gapPayer === "OFFERING_USER") pass("gap computed: 4800 pence, payer = OFFERING_USER");
  else fail(`unexpected gap: ${swap.gapPence} pence / ${swap.gapPayer}`);

  r = await fetch(`${API}/swaps/${swap.id}/pay`, post(alice));
  if (r.status === 409) pass("pay rejected before accept (409)");
  else fail(`pay-before-accept returned ${r.status}`);

  r = await fetch(`${API}/swaps/${swap.id}/confirm`, post(alice));
  if (r.status === 409) pass("confirm rejected before payment (409)");
  else fail(`confirm-before-pay returned ${r.status}`);

  // No shipments at AGREED for value-gap
  r = await fetch(`${API}/swaps/${swap.id}/shipments`, { headers: auth(alice) });
  if (r.ok) {
    const prePayShipments = (await r.json()).shipments;
    if (prePayShipments.length === 0) pass("no shipments before payment (value-gap)");
    else fail(`expected 0 shipments before payment, got ${prePayShipments.length}`);
  }

  r = await fetch(`${API}/swaps/${swap.id}/accept`, post(mallory));
  if (!r.ok) throw new Error(`accept ${r.status}: ${await r.text()}`);
  swap = (await r.json()).swap;
  if (swap.status === "AGREED") pass("accepted: swap is AGREED");
  else fail(`accept landed on ${swap.status}`);

  r = await fetch(`${API}/swaps/${swap.id}/pay`, post(mallory));
  if (r.status === 403) pass("only the gap payer can start the payment (403)");
  else fail(`non-payer pay returned ${r.status}`);

  r = await fetch(`${API}/swaps/${swap.id}/pay`, post(alice));
  if (!r.ok) throw new Error(`pay ${r.status}: ${await r.text()}`);
  const pay1 = await r.json();
  const payment = pay1.swap.payment;
  if (pay1.checkoutUrl === `${API}/stripe/dev-confirm/${payment.id}`) pass("simulated checkoutUrl points at dev-confirm");
  else fail(`checkoutUrl unexpected: ${pay1.checkoutUrl}`);
  if (payment.amountPence === 4800 && payment.feePence === 240 && payment.totalPence === 5040) {
    pass("payment math correct: 4800 + 5% fee(240) = 5040 pence");
  } else {
    fail(`payment math wrong: ${JSON.stringify({ a: payment.amountPence, f: payment.feePence, t: payment.totalPence })}`);
  }
  if (payment.status === "PENDING") pass("payment starts PENDING");
  else fail(`payment status ${payment.status}`);

  // Repeat /pay must reuse the same payment, not mint a second one.
  r = await fetch(`${API}/swaps/${swap.id}/pay`, post(alice));
  const pay2 = await r.json();
  if (pay2.swap.payment.id === payment.id) pass("repeated /pay reuses the same PENDING payment");
  else fail(`repeated /pay created a different payment (${pay2.swap.payment.id})`);

  // Simulated checkout confirmation - called twice for idempotency.
  r = await fetch(pay1.checkoutUrl, { method: "GET", redirect: "manual" });
  if (r.status === 302) pass("dev-confirm redirects on first confirmation");
  else fail(`dev-confirm #1 returned ${r.status}`);
  r = await fetch(pay1.checkoutUrl, { method: "GET", redirect: "manual" });
  if (r.status === 302) pass("dev-confirm redirects on repeat call (idempotent)");
  else fail(`dev-confirm #2 returned ${r.status}`);

  const payments = await prisma.payment.findMany({ where: { swapId: swap.id } });
  if (payments.length === 1 && payments[0].status === "PAID") pass("exactly one payment, now PAID (no double-entry)");
  else fail(`payment rows = ${payments.length}, statuses = ${payments.map((p) => p.status).join(",")}`);

  r = await fetch(`${API}/swaps/${swap.id}`, { headers: auth(alice) });
  swap = (await r.json()).swap;
  if (swap.status === "PAID") pass("swap advanced to PAID after payment confirmed");
  else fail(`swap status after payment = ${swap.status}`);

  // Shipments should now exist (created at PAID for value-gap)
  r = await fetch(`${API}/swaps/${swap.id}/shipments`, { headers: auth(alice) });
  if (!r.ok) throw new Error(`get shipments ${r.status}`);
  const { shipments: preShip } = await r.json();
  if (preShip.length === 2) pass("2 shipments created at PAID");
  else fail(`expected 2 shipments at PAID, got ${preShip.length}`);

  // Purchase labels + ship both shipments so delivery confirmation can complete the swap
  for (const s of preShip) {
    const senderToken = s.senderUserId === aliceId ? alice : mallory;
    const rRate = await fetch(`${API}/shipments/${s.id}/rates`, { headers: auth(senderToken) });
    if (!rRate.ok) throw new Error(`get rates ${rRate.status}`);
    const { rates } = await rRate.json();
    if (rates.length === 0) throw new Error("no rates available");

    const rLabel = await fetch(`${API}/shipments/${s.id}/label`, post(senderToken, { carrier: rates[0].carrier, service: rates[0].service }));
    if (!rLabel.ok) throw new Error(`purchase label ${rLabel.status}`);

    const rShip = await fetch(`${API}/shipments/${s.id}/ship`, post(senderToken));
    if (!rShip.ok) throw new Error(`mark shipped ${rShip.status}`);
  }
  pass("both shipments shipped (IN_TRANSIT)");

  // Confirm receipt: both parties. Each confirm marks their incoming
  // shipment as DELIVERED. After both, tryCompleteSwap fires.
  r = await fetch(`${API}/swaps/${swap.id}/confirm`, post(alice));
  if (!r.ok) throw new Error(`alice confirm ${r.status}: ${await r.text()}`);
  const aliceConfirm = await r.json();
  swap = aliceConfirm.swap;
  if (swap.status === "PAID" && swap.offeringUserConfirmedAt) pass("alice confirmed receipt; swap stays PAID until both shipments delivered");
  else fail(`after alice confirm: ${swap.status}`);

  r = await fetch(`${API}/swaps/${swap.id}/confirm`, post(mallory));
  if (!r.ok) throw new Error(`mallory confirm ${r.status}: ${await r.text()}`);
  const malloryConfirm = await r.json();
  swap = malloryConfirm.swap;
  if (swap.status === "COMPLETED") pass("both confirmed + both delivered: swap COMPLETED");
  else fail(`after mallory confirm: ${swap.status}`);

  // Ownership transfer: each party ends up with the other's item.
  const [offerAfter, targetAfter] = await Promise.all([
    prisma.item.findUnique({ where: { id: offer.id }, select: { ownerId: true, status: true } }),
    prisma.item.findUnique({ where: { id: target.id }, select: { ownerId: true, status: true } }),
  ]);
  if (offerAfter.ownerId === malloryId && offerAfter.status === "SWAPPED") pass("offered item transferred to mallory (SWAPPED)");
  else fail(`offered item now owned by ${offerAfter.ownerId} / ${offerAfter.status}`);
  if (targetAfter.ownerId === aliceId && targetAfter.status === "SWAPPED") pass("requested item transferred to alice (SWAPPED)");
  else fail(`requested item now owned by ${targetAfter.ownerId} / ${targetAfter.status}`);

  // Confirming a completed swap is correctly rejected (409), not a crash.
  r = await fetch(`${API}/swaps/${swap.id}/confirm`, post(alice));
  if (r.status === 409) pass("re-confirming a completed swap rejected (409)");
  else fail(`post-completion confirm returned ${r.status}`);
}

async function runCancelAfterPayFlow() {
  report.push("--- Cancel-after-pay: refund path + item release ---");

  const offer = await createItem(alice, 300, "payment-flow cancel offer");
  const target = await createItem(mallory, 900, "payment-flow cancel target");

  let r = await fetch(`${API}/swaps`, post(alice, { offeringItemId: offer.id, requestedItemId: target.id }));
  let swap = (await r.json()).swap;

  r = await fetch(`${API}/swaps/${swap.id}/accept`, post(mallory));
  swap = (await r.json()).swap;

  r = await fetch(`${API}/swaps/${swap.id}/pay`, post(alice));
  const { checkoutUrl } = await r.json();

  r = await fetch(checkoutUrl, { method: "GET", redirect: "manual" });
  if (r.status === 302) pass("cancel-flow payment confirmed (PAID)");
  else fail(`cancel-flow dev-confirm returned ${r.status}`);

  r = await fetch(`${API}/swaps/${swap.id}/cancel`, post(alice));
  if (!r.ok) throw new Error(`cancel after pay ${r.status}: ${await r.text()}`);
  swap = (await r.json()).swap;
  if (swap.status === "CANCELLED") pass("paid swap cancelled pre-motion");
  else fail(`cancel-after-pay landed on ${swap.status}`);

  // Verify shipments are cancelled too
  r = await fetch(`${API}/swaps/${swap.id}/shipments`, { headers: auth(alice) });
  if (r.ok) {
    const { shipments: cancelShipments } = await r.json();
    const allCancelled = cancelShipments.every((s) => s.status === "CANCELLED");
    if (allCancelled) pass("shipments cancelled after swap cancel");
    else fail(`shipment statuses: ${cancelShipments.map((s) => s.status).join(",")}`);
  }

  const [items, payment] = await Promise.all([
    prisma.item.findMany({
      where: { id: { in: [offer.id, target.id] } },
      select: { status: true },
    }),
    prisma.payment.findUnique({ where: { swapId: swap.id }, select: { status: true } }),
  ]);
  if (items.every((i) => i.status === "ACTIVE")) pass("items released back to ACTIVE after cancel");
  else fail(`items statuses after cancel: ${items.map((i) => i.status).join(",")}`);
  if (payment?.status === "PAID") pass("payment record retained (refund is a no-op in the simulated flow)");
  else fail(`payment status after cancel = ${payment?.status}`);
}

try {
  await runPaidSwapFlow();
  await runCancelAfterPayFlow();
} catch (e) {
  fail(`EXCEPTION: ${e.message.split("\n")[0]}`);
} finally {
  await prisma.$disconnect();
}

console.log(report.join("\n"));
console.log(`\n${report.filter((x) => x.startsWith("PASS")).length} passed / ${report.filter((x) => x.startsWith("FAIL")).length} failed`);
process.exit(report.some((x) => x.startsWith("FAIL")) ? 1 : 0);
