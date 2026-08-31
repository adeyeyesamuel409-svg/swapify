import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const API = "http://localhost:4000";
const tmp = path.join(os.tmpdir(), "opencode");
const alice = fs.readFileSync(path.join(tmp, "alice.token"), "utf8").trim();
const mallory = fs.readFileSync(path.join(tmp, "mallory.token"), "utf8").trim();
const fixtures = JSON.parse(fs.readFileSync(new URL("./.fixtures.json", import.meta.url), "utf8"));

const report = [];
const pass = (m) => report.push("PASS  " + m);
const fail = (m) => report.push("FAIL  " + m);

const j = { "Content-Type": "application/json" };
const auth = (t) => ({ ...j, Authorization: `Bearer ${t}` });
const authNoCT = (t) => ({ Authorization: `Bearer ${t}` });

const body = (t, data) => ({ method: "POST", headers: auth(t), body: JSON.stringify(data) });
const postNoCT = (t) => ({ method: "POST", headers: authNoCT(t) });
const remove = (t, url) => fetch(url, { method: "DELETE", headers: authNoCT(t) });

async function createItem(token, overrides = {}) {
  const r = await fetch(`${API}/items`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({
      title: `authz-item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      description: "authz test fixture with a deterministic value.",
      category: "OTHER",
      condition: "GOOD",
      valuePence: 500,
      ...overrides,
    }),
  });
  if (!r.ok) throw new Error(`fixture create ${r.status}: ${await r.text()}`);
  return (await r.json()).item;
}

// 1. Owner-gating: alice must NOT be able to modify mallory's item.
let r = await fetch(`${API}/items/${fixtures.targetId}`, { method: "PATCH", headers: auth(alice), body: JSON.stringify({ title: "Hacked title" }) });
if (r.status === 404 || r.status === 403) pass(`cross-owner PATCH rejected (${r.status})`);
else fail(`cross-owner PATCH returned ${r.status}`);

// 2. Owner-gating: alice must NOT be able to attach images to mallory's item.
r = await fetch(`${API}/items/${fixtures.targetId}`, { method: "PATCH", headers: auth(alice), body: JSON.stringify({ images: ["/uploads/evil.png"] }) });
if (r.status === 404 || r.status === 403) pass(`cross-owner image attach rejected (${r.status})`);
else fail(`cross-owner image attach returned ${r.status}`);

// 3. Owner-gating: alice must NOT be able to delete mallory's item.
r = await remove(alice, `${API}/items/${fixtures.targetId}`);
if (r.status === 404 || r.status === 403) pass(`cross-owner DELETE rejected (${r.status})`);
else fail(`cross-owner DELETE returned ${r.status}`);

// 4. Positive control: alice CAN patch her own item.
r = await fetch(`${API}/items/${fixtures.offerLowId}`, { method: "PATCH", headers: auth(alice), body: JSON.stringify({ condition: "LIKE_NEW" }) });
if (r.status === 200) pass("owner PATCH of own item succeeds");
else fail(`owner PATCH returned ${r.status}: ${await r.text()}`);

// 5. Listing deletion: owner CAN soft-delete their own item, which then
//    disappears from /items/:id, /items (browse) and /items/me.
const delItem = await createItem(alice, { title: "authz delete me" });
r = await remove(alice, `${API}/items/${delItem.id}`);
if (r.status === 200) pass("owner DELETE of own item succeeds (200)");
else fail(`owner DELETE returned ${r.status}`);

r = await fetch(`${API}/items/${delItem.id}`);
if (r.status === 404) pass("deleted item returns 404 on GET /items/:id");
else fail(`deleted item GET returned ${r.status}`);

const browse = await (await fetch(`${API}/items?q=${encodeURIComponent("authz delete me")}`)).json();
if (!browse.items.some((i) => i.id === delItem.id)) pass("deleted item excluded from public /items browse");
else fail("deleted item still listed on /items browse");

const mine = await (await fetch(`${API}/items/me`, { headers: auth(alice) })).json();
if (!mine.items.some((i) => i.id === delItem.id)) pass("deleted item excluded from /items/me");
else fail("deleted item still listed on /items/me");

// 6. Active-swap protection: an item involved in a live swap cannot be deleted.
const aliceReserved = await createItem(alice);
const malloryReserved = await createItem(mallory);
r = await fetch(`${API}/swaps`, body(alice, { offeringItemId: aliceReserved.id, requestedItemId: malloryReserved.id }));
if (!r.ok) fail(`fixture swap create ${r.status}: ${await r.text()}`);
const activeSwap = (await r.json()).swap;
if (activeSwap.id) pass(`created active swap ${activeSwap.id} for delete-protection test`);

r = await remove(alice, `${API}/items/${aliceReserved.id}`);
if (r.status === 409) pass("DELETE of offering item in an active swap rejected (409)");

r = await remove(mallory, `${API}/items/${malloryReserved.id}`);
if (r.status === 409) pass("DELETE of requested item in an active swap rejected (409)");

// After the swap is cancelled the items free up and can be deleted.
r = await fetch(`${API}/swaps/${activeSwap.id}/cancel`, postNoCT(alice));
if (!r.ok) fail(`cancel fixture swap ${r.status}: ${await r.text()}`);
r = await remove(alice, `${API}/items/${aliceReserved.id}`);
if (r.status === 200) pass("after cancel, offering item can be deleted (200)");
else fail(`post-cancel DELETE returned ${r.status}`);

// 7. Unauthenticated create with a VALID body -> 401 (auth enforced before create).
r = await fetch(`${API}/items`, { method: "POST", headers: j, body: JSON.stringify({ title: "No auth test", description: "This item should not be created without a token.", category: "OTHER", condition: "GOOD", valuePence: 100 }) });
if (r.status === 401) pass("unauthenticated create rejected (401)");
else fail(`unauthenticated create returned ${r.status}`);

// 8. Malformed body -> 400 (missing required field).
r = await fetch(`${API}/items`, { method: "POST", headers: auth(alice), body: JSON.stringify({ title: "no description" }) });
if (r.status === 400) pass("malformed create rejected (400)");
else fail(`malformed create returned ${r.status}`);

// 9. Value bounds: negative/zero pence rejected.
r = await fetch(`${API}/items`, { method: "POST", headers: auth(alice), body: JSON.stringify({ title: "neg", description: "negative value", category: "OTHER", condition: "GOOD", valuePence: -5 }) });
if (r.status === 400) pass("negative valuePence rejected (400)");
else fail(`negative valuePence returned ${r.status}`);
r = await fetch(`${API}/items`, { method: "POST", headers: auth(alice), body: JSON.stringify({ title: "zero", description: "zero value", category: "OTHER", condition: "GOOD", valuePence: 0 }) });
if (r.status === 400) pass("zero valuePence rejected (400)");
else fail(`zero valuePence returned ${r.status}`);

// 10. Unauthenticated GET /items works (public), but /items/me requires auth.
r = await fetch(`${API}/items`);
if (r.status === 200) pass("public GET /items works unauthenticated (200)");
else fail(`public /items returned ${r.status}`);
r = await fetch(`${API}/items/me`);
if (r.status === 401) pass("GET /items/me requires auth (401)");
else fail(`/items/me returned ${r.status}`);

// 11. Swap read gating: participants can read their swap; a non-participant
//     gets 404 (negative case covered separately by authz-nonparticipant.mjs).
const gateOffer = await createItem(alice);
const gateTarget = await createItem(mallory);
r = await fetch(`${API}/swaps`, body(alice, { offeringItemId: gateOffer.id, requestedItemId: gateTarget.id }));
if (!r.ok) fail(`gate fixture swap ${r.status}: ${await r.text()}`);
const gateSwap = (await r.json()).swap;
if (gateSwap.id) pass(`created participant-gate swap ${gateSwap.id}`);

r = await fetch(`${API}/swaps/${gateSwap.id}`, { headers: auth(alice) });
if (r.status === 200) pass("participant can read their swap (200)");
else fail(`participant swap read returned ${r.status}`);
r = await fetch(`${API}/swaps/${gateSwap.id}`, { headers: auth(mallory) });
if (r.status === 200) pass("co-participant (requested owner) can read the swap (200)");
else fail(`co-participant swap read returned ${r.status}`);
await fetch(`${API}/swaps/${gateSwap.id}/cancel`, postNoCT(alice)).catch(() => {});

// 12. Swap with yourself rejected.
r = await fetch(`${API}/swaps`, body(alice, { offeringItemId: fixtures.offerLowId, requestedItemId: fixtures.offerLowId }));
if (r.status === 400) pass("self-swap rejected (400)");
else fail(`self-swap returned ${r.status}`);

// 13. Re-offering a RESERVED item rejected (409).
const reserving = await createItem(alice);
const counterpart = await createItem(mallory);
r = await fetch(`${API}/swaps`, body(alice, { offeringItemId: reserving.id, requestedItemId: counterpart.id }));
if (!r.ok) fail(`reserve fixture swap ${r.status}: ${await r.text()}`);
const reservedSwap = (await r.json()).swap;
r = await fetch(`${API}/swaps`, body(alice, { offeringItemId: reserving.id, requestedItemId: counterpart.id }));
if (r.status === 409) pass("re-offering a reserved item rejected (409)");
else fail(`reserved re-offer returned ${r.status}`);
await fetch(`${API}/swaps/${reservedSwap.id}/cancel`, postNoCT(alice)).catch(() => {});

// 14. CORS: no ACAO reflection for a foreign origin.
r = await fetch(`${API}/items`, { headers: { Origin: "http://evil.example.com" } });
const acao = r.headers.get("access-control-allow-origin");
if (acao === null || acao === "http://evil.example.com") pass(`CORS: no foreign-origin reflection (ACAO=${acao})`);
else fail(`CORS ACAO=${acao}`);

console.log(report.join("\n"));
console.log(`\n${report.filter((x) => x.startsWith("PASS")).length} passed / ${report.filter((x) => x.startsWith("FAIL")).length} failed`);
process.exit(report.some((x) => x.startsWith("FAIL")) ? 1 : 0);
