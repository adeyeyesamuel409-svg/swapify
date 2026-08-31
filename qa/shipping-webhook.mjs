// Shipping-webhook test: verifies the webhook endpoint accepts provider
// callbacks and updates shipment status. Tests delivery-triggered completion:
// when both shipments reach DELIVERED via webhooks, the swap completes atomically.

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
    body: JSON.stringify({ title, description: "webhook-test fixture.", category: "OTHER", condition: "GOOD", valuePence }),
  });
  if (!r.ok) throw new Error(`create item ${r.status}: ${await r.text()}`);
  return (await r.json()).item;
}

// ── 1. Single webhook delivery + no premature completion ─────────────────────
report.push("\n--- 1. Single webhook DELIVERED: swap NOT completed ---");

const item1 = await createItem(alice, 400, "webhook item A");
const item2 = await createItem(mallory, 400, "webhook item B");

let r = await fetch(`${API}/swaps`, post(alice, { offeringItemId: item1.id, requestedItemId: item2.id }));
let swap = (await r.json()).swap;
r = await fetch(`${API}/swaps/${swap.id}/accept`, post(mallory));
swap = (await r.json()).swap;

if (swap.status !== "AGREED") {
  fail(`swap not AGREED: ${swap.status}`);
} else {
  // Get shipments (created at AGREED for equal-value)
  r = await fetch(`${API}/swaps/${swap.id}/shipments`, { headers: auth(alice) });
  const { shipments } = await r.json();
  if (shipments.length !== 2) {
    fail(`expected 2 shipments, got ${shipments.length}`);
  } else {
    const aliceShipment = shipments.find((s) => s.senderUserId === swap.offeringUserId);
    const malloryShipment = shipments.find((s) => s.senderUserId === swap.requestedUserId);

    // Purchase label and ship alice's shipment
    r = await fetch(`${API}/shipments/${aliceShipment.id}/label`, post(alice, { carrier: "SimMail", service: "standard" }));
    if (!r.ok) throw new Error(`purchase label ${r.status}`);
    r = await fetch(`${API}/shipments/${aliceShipment.id}/ship`, post(alice));
    if (!r.ok) throw new Error(`mark shipped ${r.status}`);

    // Send webhook for alice's shipment → DELIVERED
    const webhookBody = {
      type: "shipment.status_changed",
      data: {
        providerShipmentId: "sim_ship_webhook_test_1",
        status: "DELIVERED",
        trackingNumber: "SIM1111111111",
      },
    };

    // First, set the providerShipmentId on the shipment so the webhook can find it
    await prisma.shipment.update({
      where: { id: aliceShipment.id },
      data: { providerShipmentId: "sim_ship_webhook_test_1" },
    });

    r = await fetch(`${API}/webhooks/shipping`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-webhook-signature": "test-sig" },
      body: JSON.stringify(webhookBody),
    });
    if (r.ok) pass("webhook accepted (200)");
    else fail(`webhook returned ${r.status}`);

    // Alice's shipment should be DELIVERED
    const updated = await prisma.shipment.findUnique({ where: { id: aliceShipment.id } });
    if (updated.status === "DELIVERED") pass("alice shipment DELIVERED after webhook");
    else fail(`alice shipment status: ${updated.status}`);

    // Swap should NOT be completed — only one shipment delivered
    const swapAfter = await prisma.swap.findUnique({ where: { id: swap.id } });
    if (swapAfter.status === "AGREED") pass("swap still AGREED — only one shipment delivered");
    else fail(`swap status after one webhook: ${swapAfter.status}`);
  }
}

// ── 2. Second webhook completes the swap ─────────────────────────────────────
report.push("\n--- 2. Both webhooks DELIVERED: swap COMPLETED ---");

if (swap.status === "AGREED") {
  r = await fetch(`${API}/swaps/${swap.id}/shipments`, { headers: auth(alice) });
  const { shipments } = await r.json();
  const malloryShipment = shipments.find((s) => s.senderUserId === swap.requestedUserId);

  // Purchase label and ship mallory's shipment
  r = await fetch(`${API}/shipments/${malloryShipment.id}/label`, post(mallory, { carrier: "SimMail", service: "standard" }));
  if (!r.ok) throw new Error(`purchase label ${r.status}`);
  r = await fetch(`${API}/shipments/${malloryShipment.id}/ship`, post(mallory));
  if (!r.ok) throw new Error(`mark shipped ${r.status}`);

  // Set providerShipmentId so webhook matches
  await prisma.shipment.update({
    where: { id: malloryShipment.id },
    data: { providerShipmentId: "sim_ship_webhook_test_2" },
  });

  // Send webhook for mallory's shipment → DELIVERED
  r = await fetch(`${API}/webhooks/shipping`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-signature": "test-sig" },
    body: JSON.stringify({
      type: "shipment.status_changed",
      data: {
        providerShipmentId: "sim_ship_webhook_test_2",
        status: "DELIVERED",
        trackingNumber: "SIM2222222222",
      },
    }),
  });
  if (r.ok) pass("second webhook accepted");
  else fail(`second webhook returned ${r.status}`);

  // Both shipments DELIVERED → swap should now be COMPLETED
  const swapFinal = await prisma.swap.findUnique({ where: { id: swap.id } });
  if (swapFinal.status === "COMPLETED") pass("swap COMPLETED after both shipments DELIVERED");
  else fail(`swap status after both webhooks: ${swapFinal.status}`);

  // Ownership transfer check
  const [offeringItem, requestedItem] = await Promise.all([
    prisma.item.findUnique({ where: { id: swap.offeringItemId }, select: { ownerId: true } }),
    prisma.item.findUnique({ where: { id: swap.requestedItemId }, select: { ownerId: true } }),
  ]);
  if (offeringItem.ownerId === swap.requestedUserId && requestedItem.ownerId === swap.offeringUserId) {
    pass("ownership transferred after completion");
  } else {
    fail(`ownership wrong: offering→${offeringItem.ownerId}, requested→${requestedItem.ownerId}`);
  }
}

// ── 3. Duplicate webhook is idempotent ───────────────────────────────────────
report.push("\n--- 3. Duplicate webhook idempotent ---");

r = await fetch(`${API}/webhooks/shipping`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-webhook-signature": "test-sig" },
  body: JSON.stringify({
    type: "shipment.status_changed",
    data: {
      providerShipmentId: "sim_ship_webhook_test_1",
      status: "DELIVERED",
    },
  }),
});
if (r.ok) pass("duplicate webhook accepted (200)");
else fail(`duplicate webhook returned ${r.status}`);

// ── 4. Out-of-order webhook cannot regress status ────────────────────────────
report.push("\n--- 4. Webhook regression blocked ---");

r = await fetch(`${API}/webhooks/shipping`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-webhook-signature": "test-sig" },
  body: JSON.stringify({
    type: "shipment.status_changed",
    data: {
      providerShipmentId: "sim_ship_webhook_test_1",
      status: "IN_TRANSIT",
    },
  }),
});
if (r.ok) pass("regression webhook accepted (200) — but status unchanged");
else fail(`regression webhook returned ${r.status}`);

const afterRegression = await prisma.shipment.findFirst({ where: { providerShipmentId: "sim_ship_webhook_test_1" } });
if (afterRegression.status === "DELIVERED") pass("shipment stays DELIVERED after regression webhook");
else fail(`shipment status after regression: ${afterRegression.status}`);

// ── 5. Webhook for unknown providerShipmentId ────────────────────────────────
report.push("\n--- 5. Webhook unknown shipment ---");

r = await fetch(`${API}/webhooks/shipping`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-webhook-signature": "test" },
  body: JSON.stringify({
    type: "shipment.status_changed",
    data: { providerShipmentId: "nonexistent_123", status: "DELIVERED" },
  }),
});
if (r.ok) pass("webhook for unknown shipment returns 200 (idempotent)");
else fail(`unknown shipment webhook returned ${r.status}`);

// ── 6. Webhook with invalid signature ────────────────────────────────────────
report.push("\n--- 6. Webhook invalid signature ---");

// Simulated provider always returns true for verifyWebhookSignature.
r = await fetch(`${API}/webhooks/shipping`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: "test", data: {} }),
});
if (r.ok) pass("webhook endpoint accepts (simulated sig always valid)");
else fail(`webhook endpoint returned ${r.status}`);

await prisma.$disconnect();

console.log("\n" + report.join("\n"));
const failures = report.filter((l) => l.startsWith("FAIL"));
console.log(`\n${report.filter((l) => l.startsWith("PASS")).length} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
