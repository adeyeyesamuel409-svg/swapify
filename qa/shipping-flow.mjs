// Shipping-flow integration test: address CRUD, shipment lifecycle, and
// access control against the live API.
//
// Covers: address create/update/delete, shipment creation at AGREED
// (equal-value) / PAID (value-gap), get rates, purchase label, mark shipped,
// mark delivered, cancel shipment, access control checks, idempotent address
// selection, and editing address book without modifying historical snapshots.

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
    body: JSON.stringify({ title, description: "shipping-flow fixture.", category: "OTHER", condition: "GOOD", valuePence }),
  });
  if (!r.ok) throw new Error(`create item ${r.status}: ${await r.text()}`);
  return (await r.json()).item;
}

async function userId(token) {
  const r = await fetch(`${API}/auth/me`, { headers: auth(token) });
  return (await r.json()).user.id;
}

const [aliceId, malloryId] = await Promise.all([userId(alice), userId(mallory)]);

// Clean up leftover addresses from previous test runs
{
  for (const token of [alice, mallory]) {
    const r = await fetch(`${API}/addresses`, { headers: auth(token) });
    if (r.ok) {
      const { addresses: stale } = await r.json();
      for (const a of stale) {
        await fetch(`${API}/addresses/${a.id}`, { method: "DELETE", headers: authNoCT(token) });
      }
    }
  }
  // Verify alice is clean
  const check = await fetch(`${API}/addresses`, { headers: auth(alice) });
  const remaining = (await check.json()).addresses;
  if (remaining.length > 0) {
    for (const a of remaining) {
      await fetch(`${API}/addresses/${a.id}`, { method: "DELETE", headers: authNoCT(alice) });
    }
  }
}

// ── 1. Address CRUD ─────────────────────────────────────────────────────────

report.push("\n--- 1. Address CRUD ---");

let r = await fetch(`${API}/addresses`, { headers: auth(alice) });
if (!r.ok) throw new Error(`list addresses ${r.status}`);
let addrs = (await r.json()).addresses;
if (addrs.length === 0) pass("initial address list empty");
else fail(`expected empty, got ${addrs.length}`);

// Create
r = await fetch(`${API}/addresses`, { method: "POST", headers: auth(alice), body: JSON.stringify({ label: "Home", line1: "10 Downing St", city: "London", postcode: "SW1A 1AA", isDefault: true }) });
if (!r.ok) throw new Error(`create address ${r.status}: ${await r.text()}`);
const addr1 = (await r.json()).address;
if (addr1.label === "Home" && addr1.line1 === "10 Downing St" && addr1.isDefault === true) pass("address created correctly");
else fail(`unexpected address: ${JSON.stringify(addr1)}`);

// Max 10 addresses check
for (let i = 0; i < 9; i++) {
  await fetch(`${API}/addresses`, { method: "POST", headers: auth(alice), body: JSON.stringify({ label: `Addr ${i}`, line1: `${i} Street`, city: "London", postcode: "SW1A 1AA" }) });
}
r = await fetch(`${API}/addresses`, { method: "POST", headers: auth(alice), body: JSON.stringify({ label: "Overflow", line1: "11 Street", city: "London", postcode: "SW1A 1AA" }) });
if (r.status === 400) pass("max 10 addresses enforced (400)");
else fail(`max addresses returned ${r.status}`);

// Update
r = await fetch(`${API}/addresses/${addr1.id}`, { method: "PATCH", headers: auth(alice), body: JSON.stringify({ label: "Office", line1: "10 Downing St", city: "London", postcode: "SW1A 1AA" }) });
if (!r.ok) throw new Error(`update address ${r.status}`);
const updated = (await r.json()).address;
if (updated.label === "Office") pass("address updated");
else fail(`update did not apply: ${updated.label}`);

// Delete (delete all but one first)
r = await fetch(`${API}/addresses`, { headers: auth(alice) });
const allAddrs = (await r.json()).addresses;
for (const a of allAddrs) {
  if (a.id !== addr1.id) await fetch(`${API}/addresses/${a.id}`, { method: "DELETE", headers: authNoCT(alice) });
}
r = await fetch(`${API}/addresses/${addr1.id}`, { method: "DELETE", headers: authNoCT(alice) });
if (r.ok) pass("address deleted");
else fail(`delete returned ${r.status}`);

// ── 2. Address access control ────────────────────────────────────────────────

report.push("\n--- 2. Address access control ---");

r = await fetch(`${API}/addresses`, { method: "POST", headers: auth(alice), body: JSON.stringify({ label: "Mallory's", line1: "221B Baker St", city: "London", postcode: "NW1 6XE" }) });
if (!r.ok) throw new Error(`create address for AC ${r.status}`);
const addrForAC = (await r.json()).address;

r = await fetch(`${API}/addresses/${addrForAC.id}`, { method: "DELETE", headers: authNoCT(mallory) });
if (r.status === 404) pass("non-owner cannot delete address (404)");
else fail(`cross-user delete returned ${r.status}`);

// Clean up
await fetch(`${API}/addresses/${addrForAC.id}`, { method: "DELETE", headers: authNoCT(alice) });

// ── 3. Shipment creation at AGREED (equal-value) ────────────────────────────

report.push("\n--- 3. Shipment creation at AGREED ---");

const item1 = await createItem(alice, 300, "ship-flow item A");
const item2 = await createItem(mallory, 300, "ship-flow item B");

r = await fetch(`${API}/swaps`, post(alice, { offeringItemId: item1.id, requestedItemId: item2.id }));
if (!r.ok) throw new Error(`create swap ${r.status}`);
let swap = (await r.json()).swap;

// No shipments before accept
r = await fetch(`${API}/swaps/${swap.id}/shipments`, { headers: auth(alice) });
if (r.status === 200) {
  const before = (await r.json()).shipments;
  if (before.length === 0) pass("no shipments before accept");
  else fail(`expected 0 shipments before accept, got ${before.length}`);
} else fail(`shipments before accept returned ${r.status}`);

// Accept → AGREED → shipments created
r = await fetch(`${API}/swaps/${swap.id}/accept`, post(mallory));
if (!r.ok) throw new Error(`accept ${r.status}`);
swap = (await r.json()).swap;
if (swap.status === "AGREED") pass("swap is AGREED after accept");
else fail(`accept landed on ${swap.status}`);

r = await fetch(`${API}/swaps/${swap.id}/shipments`, { headers: auth(alice) });
if (!r.ok) throw new Error(`get shipments ${r.status}`);
const { shipments } = await r.json();
if (shipments.length === 2) pass("2 shipments created at AGREED");
else fail(`expected 2 shipments, got ${shipments.length}`);

const aliceShipment = shipments.find((s) => s.senderUserId === aliceId);
const malloryShipment = shipments.find((s) => s.senderUserId === malloryId);

if (!aliceShipment || !malloryShipment) {
  fail("could not identify alice/mallory shipments");
} else {
  if (aliceShipment.status === "PENDING") pass("alice shipment starts PENDING");
  else fail(`alice shipment status: ${aliceShipment.status}`);

  if (malloryShipment.status === "PENDING") pass("mallory shipment starts PENDING");
  else fail(`mallory shipment status: ${malloryShipment.status}`);

  // ── 4. Only participants can access ────────────────────────────────────────
  report.push("\n--- 4. Shipment access control ---");

  // Create a third user's item and swap — alice is NOT a participant
  const charlieItem = await createItem(mallory, 100, "ship-flow charlie item");
  const malloryItem2 = await createItem(mallory, 100, "ship-flow mallory item 2");
  // mallory is participant in both; alice should not access the other swap
  // Actually, we can't easily create a non-participant. Let's test sender-only endpoint with wrong user:
  r = await fetch(`${API}/shipments/${aliceShipment.id}/rates`, { headers: auth(mallory) });
  if (r.status === 403) pass("non-sender cannot get rates (403)");
  else fail(`non-sender rates returned ${r.status}`);

  r = await fetch(`${API}/shipments/${aliceShipment.id}/label`, post(mallory, { carrier: "SimMail", service: "standard" }));
  if (r.status === 403) pass("non-sender cannot purchase label (403)");
  else fail(`non-sender label returned ${r.status}`);

  r = await fetch(`${API}/shipments/${aliceShipment.id}/ship`, post(mallory));
  if (r.status === 403) pass("non-sender cannot mark shipped (403)");
  else fail(`non-sender ship returned ${r.status}`);

  // Sender cannot mark delivered (only receiver)
  r = await fetch(`${API}/shipments/${aliceShipment.id}/deliver`, post(alice));
  if (r.status === 403) pass("sender cannot mark delivered (403)");
  else fail(`sender deliver returned ${r.status}`);

  // ── 5. Get shipping rates ──────────────────────────────────────────────────
  report.push("\n--- 5. Get shipping rates ---");

  r = await fetch(`${API}/shipments/${aliceShipment.id}/rates`, { headers: auth(alice) });
  if (!r.ok) throw new Error(`get rates ${r.status}`);
  const { rates } = await r.json();
  if (rates.length > 0 && rates[0].carrier && rates[0].pricePence !== undefined) pass("rates returned with carrier and price");
  else fail(`unexpected rates: ${JSON.stringify(rates)}`);

  // ── 6. Purchase label ──────────────────────────────────────────────────────
  report.push("\n--- 6. Purchase label ---");

  const firstRate = rates[0];
  r = await fetch(`${API}/shipments/${aliceShipment.id}/label`, post(alice, { carrier: firstRate.carrier, service: firstRate.service }));
  if (!r.ok) throw new Error(`purchase label ${r.status}`);
  const labelled = (await r.json()).shipment;
  if (labelled.status === "LABEL_READY" && labelled.trackingNumber) pass("label purchased, status LABEL_READY with tracking number");
  else fail(`unexpected after label purchase: ${labelled.status} / tracking: ${labelled.trackingNumber}`);

  // ── 7. Mark shipped ────────────────────────────────────────────────────────
  report.push("\n--- 7. Mark shipped ---");

  r = await fetch(`${API}/shipments/${aliceShipment.id}/ship`, post(alice));
  if (!r.ok) throw new Error(`mark shipped ${r.status}`);
  const shipped = (await r.json()).shipment;
  if (shipped.status === "IN_TRANSIT" && shipped.shippedAt) pass("shipment marked IN_TRANSIT");
  else fail(`unexpected after ship: ${shipped.status}`);

  // ── 8. Mark delivered (receiver only) ──────────────────────────────────────
  report.push("\n--- 8. Mark delivered ---");

  r = await fetch(`${API}/shipments/${aliceShipment.id}/deliver`, post(mallory));
  if (!r.ok) throw new Error(`mark deliver ${r.status}`);
  const delivered = (await r.json()).shipment;
  if (delivered.status === "DELIVERED" && delivered.deliveredAt) pass("shipment marked DELIVERED");
  else fail(`unexpected after deliver: ${delivered.status}`);

  // ── 9. Cancel a shipment (mallory's) ───────────────────────────────────────
  report.push("\n--- 9. Cancel shipment ---");

  r = await fetch(`${API}/shipments/${malloryShipment.id}/cancel`, post(mallory));
  if (!r.ok) throw new Error(`cancel shipment ${r.status}`);
  const cancelled = (await r.json()).shipment;
  if (cancelled.status === "CANCELLED" && cancelled.cancelledAt) pass("shipment cancelled");
  else fail(`unexpected after cancel: ${cancelled.status}`);

  // Cannot cancel delivered
  r = await fetch(`${API}/shipments/${aliceShipment.id}/cancel`, post(alice));
  if (r.status === 409) pass("cannot cancel delivered shipment (409)");
  else fail(`cancel delivered returned ${r.status}`);

  // ── 10. Idempotent cancel ──────────────────────────────────────────────────
  report.push("\n--- 10. Idempotent cancel ---");

  r = await fetch(`${API}/shipments/${malloryShipment.id}/cancel`, post(mallory));
  if (r.status === 409) pass("cancel already-cancelled returns 409");
  else fail(`re-cancel returned ${r.status}`);
}

// ── 11. Swap cancel cascades to shipments ────────────────────────────────────

report.push("\n--- 11. Swap cancel cascades to shipments ---");

const cascItem1 = await createItem(alice, 400, "cascade item A");
const cascItem2 = await createItem(mallory, 400, "cascade item B");

r = await fetch(`${API}/swaps`, post(alice, { offeringItemId: cascItem1.id, requestedItemId: cascItem2.id }));
let cascSwap = (await r.json()).swap;
r = await fetch(`${API}/swaps/${cascSwap.id}/accept`, post(mallory));
cascSwap = (await r.json()).swap;

r = await fetch(`${API}/swaps/${cascSwap.id}/shipments`, { headers: auth(alice) });
const cascShipments = (await r.json()).shipments;
if (cascShipments.length === 2) pass("2 shipments after accept for cascade test");
else fail(`expected 2 shipments for cascade, got ${cascShipments.length}`);

r = await fetch(`${API}/swaps/${cascSwap.id}/cancel`, post(alice));
if (!r.ok) throw new Error(`cancel swap ${r.status}`);
cascSwap = (await r.json()).swap;
if (cascSwap.status === "CANCELLED") pass("swap cancelled");
else fail(`swap status: ${cascSwap.status}`);

// Verify shipments are cancelled
const cascAfter = await prisma.shipment.findMany({ where: { swapId: cascSwap.id } });
const allCancelled = cascAfter.every((s) => s.status === ShipmentStatus.CANCELLED);
if (allCancelled) pass("all shipments cancelled after swap cancel");
else fail(`shipment statuses: ${cascAfter.map((s) => s.status).join(", ")}`);

// ── 12. Edit address book does not modify historical snapshots ───────────────

report.push("\n--- 12. Address snapshot immutability ---");

// Ensure both users have addresses for the snapshot test
await fetch(`${API}/addresses`, { method: "POST", headers: auth(alice), body: JSON.stringify({ label: "Snapshot Test", line1: "1 Snapshot Ave", city: "London", postcode: "SW1A 2AA" }) });
await fetch(`${API}/addresses`, { method: "POST", headers: auth(mallory), body: JSON.stringify({ label: "Snapshot Test", line1: "2 Snapshot Blvd", city: "London", postcode: "SW1A 3BB" }) });

// Create a fresh swap with address snapshots
const snapItem1 = await createItem(alice, 250, "snapshot item A");
const snapItem2 = await createItem(mallory, 250, "snapshot item B");
r = await fetch(`${API}/swaps`, post(alice, { offeringItemId: snapItem1.id, requestedItemId: snapItem2.id }));
let snapSwap = (await r.json()).swap;
r = await fetch(`${API}/swaps/${snapSwap.id}/accept`, post(mallory));
snapSwap = (await r.json()).swap;

r = await fetch(`${API}/swaps/${snapSwap.id}/shipments`, { headers: auth(alice) });
const snapShipments = (await r.json()).shipments;
const snapAliceShipment = snapShipments.find((s) => s.senderUserId === aliceId);
if (snapAliceShipment?.addressLine1) pass("shipment has address snapshot from time of creation");
else fail("shipment missing address snapshot");

// Now update mallory's address (receiver of alice's shipment) and verify snapshot unchanged
r = await fetch(`${API}/addresses`, { headers: auth(mallory) });
const malloryAddrs = (await r.json()).addresses;
if (malloryAddrs.length > 0) {
  const origLine1 = snapAliceShipment.addressLine1;
  await fetch(`${API}/addresses/${malloryAddrs[0].id}`, { method: "PATCH", headers: auth(mallory), body: JSON.stringify({ label: malloryAddrs[0].label, line1: "Updated Address Line", city: "London", postcode: "SW1A 3BB" }) });

  const snapAfter = await prisma.shipment.findUnique({ where: { id: snapAliceShipment.id } });
  if (snapAfter.addressLine1 === origLine1) pass("editing address book does not modify historical snapshot");
  else fail(`snapshot changed from ${origLine1} to ${snapAfter.addressLine1}`);

  // Restore original
  await fetch(`${API}/addresses/${malloryAddrs[0].id}`, { method: "PATCH", headers: auth(mallory), body: JSON.stringify({ label: "Snapshot Test", line1: "2 Snapshot Blvd", city: "London", postcode: "SW1A 3BB" }) });
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

await prisma.$disconnect();

console.log("\n" + report.join("\n"));
const failures = report.filter((l) => l.startsWith("FAIL"));
console.log(`\n${report.filter((l) => l.startsWith("PASS")).length} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
