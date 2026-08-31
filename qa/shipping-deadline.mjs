// Shipping-deadline test: verifies the sweeper enforces postage and ship
// deadlines, and that the cancellation cascade works when a swap is expired.
//
// In the new lifecycle, shipments are created at AGREED (equal-value) or
// PAID (value-gap), so deadline enforcement runs on those early shipments.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const API = "http://localhost:4000";
const tmp = path.join(os.tmpdir(), "opencode");
const alice = fs.readFileSync(path.join(tmp, "alice.token"), "utf8").trim();
const mallory = fs.readFileSync(path.join(tmp, "mallory.token"), "utf8").trim();

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://swapify:swapify@localhost:5432/swapify?schema=public";
const { PrismaClient, ShipmentStatus } = await import("@swapify/db");
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
    body: JSON.stringify({ title, description: "shipping-deadline fixture.", category: "OTHER", condition: "GOOD", valuePence }),
  });
  if (!r.ok) throw new Error(`create item ${r.status}: ${await r.text()}`);
  return (await r.json()).item;
}

async function userId(token) {
  const r = await fetch(`${API}/auth/me`, { headers: auth(token) });
  return (await r.json()).user.id;
}

const [aliceId] = await Promise.all([userId(alice)]);

// ── 1. Postage deadline auto-cancel ──────────────────────────────────────────
report.push("\n--- 1. Postage deadline auto-cancel ---");

// Create equal-value swap → shipments at AGREED
const item1 = await createItem(alice, 500, "deadline item A");
const item2 = await createItem(mallory, 500, "deadline item B");

let r = await fetch(`${API}/swaps`, post(alice, { offeringItemId: item1.id, requestedItemId: item2.id }));
let swap = (await r.json()).swap;
r = await fetch(`${API}/swaps/${swap.id}/accept`, post(mallory));
swap = (await r.json()).swap;

if (swap.status !== "AGREED") {
  fail(`swap not AGREED: ${swap.status}`);
} else {
  // Get shipments
  r = await fetch(`${API}/swaps/${swap.id}/shipments`, { headers: auth(alice) });
  const { shipments } = await r.json();
  if (shipments.length !== 2) fail(`expected 2 shipments, got ${shipments.length}`);
  else {
    const aliceShipment = shipments.find((s) => s.senderUserId === aliceId);

    // Verify starts PENDING with a future deadline
    const pre = await prisma.shipment.findUnique({ where: { id: aliceShipment.id } });
    if (pre.status === "PENDING" && pre.postageDeadline) pass("shipment starts PENDING with postage deadline");
    else fail(`pre-deadline: status=${pre.status}, deadline=${pre.postageDeadline}`);

    // Manually set postageDeadline to the past
    await prisma.shipment.update({
      where: { id: aliceShipment.id },
      data: { postageDeadline: new Date(Date.now() - 1000) },
    });

    // Run sweeper
    const { enforcePostageDeadlines } = await import("../apps/api/dist/services/shipping-sweeper.js");
    const cancelled = await enforcePostageDeadlines();
    if (cancelled >= 1) pass("sweeper cancelled expired postage deadline shipment");
    else fail(`sweeper cancelled count: ${cancelled}`);

    // Verify
    const updated = await prisma.shipment.findUnique({ where: { id: aliceShipment.id } });
    if (updated.status === "CANCELLED") pass("shipment is now CANCELLED after deadline");
    else fail(`shipment status after deadline: ${updated.status}`);
  }
}

// ── 2. Ship deadline auto-cancel ─────────────────────────────────────────────
report.push("\n--- 2. Ship deadline auto-cancel ---");

// Create another equal-value swap
const item3 = await createItem(alice, 600, "ship-deadline item A");
const item4 = await createItem(mallory, 600, "ship-deadline item B");

r = await fetch(`${API}/swaps`, post(alice, { offeringItemId: item3.id, requestedItemId: item4.id }));
swap = (await r.json()).swap;
r = await fetch(`${API}/swaps/${swap.id}/accept`, post(mallory));
swap = (await r.json()).swap;

if (swap.status !== "AGREED") {
  fail(`second swap not AGREED: ${swap.status}`);
} else {
  r = await fetch(`${API}/swaps/${swap.id}/shipments`, { headers: auth(alice) });
  const { shipments } = await r.json();
  const aliceShipment = shipments.find((s) => s.senderUserId === aliceId);

  // Purchase label then set ship deadline to the past
  r = await fetch(`${API}/shipments/${aliceShipment.id}/label`, post(alice, { carrier: "SimMail", service: "standard" }));
  if (!r.ok) throw new Error(`purchase label ${r.status}`);

  const labelled = await prisma.shipment.findUnique({ where: { id: aliceShipment.id } });
  if (labelled.status !== "LABEL_READY") {
    fail(`expected LABEL_READY after purchase, got ${labelled.status}`);
  } else {
    // Verify shipDeadline exists
    if (labelled.shipDeadline) pass("labelled shipment has ship deadline");
    else fail("labelled shipment missing ship deadline");

    await prisma.shipment.update({
      where: { id: aliceShipment.id },
      data: { shipDeadline: new Date(Date.now() - 1000) },
    });

    const { enforceShipDeadlines } = await import("../apps/api/dist/services/shipping-sweeper.js");
    const cancelled = await enforceShipDeadlines();
    if (cancelled >= 1) pass("sweeper cancelled expired ship deadline shipment");
    else fail(`sweeper cancelled count: ${cancelled}`);

    const updated = await prisma.shipment.findUnique({ where: { id: aliceShipment.id } });
    if (updated.status === "CANCELLED") pass("labelled shipment CANCELLED after ship deadline");
    else fail(`shipment status after ship deadline: ${updated.status}`);
  }
}

// ── 3. Swap expiry cascades to shipments ─────────────────────────────────────
report.push("\n--- 3. Swap expiry cancels shipments ---");

const item5 = await createItem(alice, 700, "cascade item A");
const item6 = await createItem(mallory, 700, "cascade item B");

r = await fetch(`${API}/swaps`, post(alice, { offeringItemId: item5.id, requestedItemId: item6.id }));
swap = (await r.json()).swap;
r = await fetch(`${API}/swaps/${swap.id}/accept`, post(mallory));
swap = (await r.json()).swap;

if (swap.status !== "AGREED") {
  fail(`cascade swap not AGREED: ${swap.status}`);
} else {
  r = await fetch(`${API}/swaps/${swap.id}/shipments`, { headers: auth(alice) });
  const { shipments } = await r.json();
  if (shipments.length !== 2) {
    fail(`expected 2 shipments for cascade, got ${shipments.length}`);
  } else {
    const aliceShipment = shipments.find((s) => s.senderUserId === aliceId);

    // Verify shipments start PENDING
    const pre = await prisma.shipment.findUnique({ where: { id: aliceShipment.id } });
    if (pre.status === "PENDING") pass("shipment starts PENDING before cascade");
    else fail(`shipment pre-cascade: ${pre.status}`);

    // Cancel the swap → shipments should cascade to CANCELLED
    r = await fetch(`${API}/swaps/${swap.id}/cancel`, post(alice));
    if (!r.ok) throw new Error(`cancel swap ${r.status}`);
    swap = (await r.json()).swap;
    if (swap.status === "CANCELLED") pass("swap cancelled for cascade test");
    else fail(`swap status: ${swap.status}`);

    // Verify shipments are cancelled
    const after = await prisma.shipment.findMany({ where: { id: { in: shipments.map((s) => s.id) } } });
    const allCancelled = after.every((s) => s.status === ShipmentStatus.CANCELLED);
    if (allCancelled) pass("all shipments cancelled after swap expiry/cancel");
    else fail(`shipment statuses: ${after.map((s) => s.status).join(", ")}`);
  }
}

await prisma.$disconnect();

console.log("\n" + report.join("\n"));
const failures = report.filter((l) => l.startsWith("FAIL"));
console.log(`\n${report.filter((l) => l.startsWith("PASS")).length} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
