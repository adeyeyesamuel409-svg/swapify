import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const API = "http://localhost:4000";
const tmp = path.join(os.tmpdir(), "opencode");
const aliceToken = fs.readFileSync(path.join(tmp, "alice.token"), "utf8").trim();
const malloryToken = fs.readFileSync(path.join(tmp, "mallory.token"), "utf8").trim();

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function uploadImage(token) {
  const form = new FormData();
  form.append("images", new Blob([PNG], { type: "image/png" }), "fixture.png");
  const res = await fetch(`${API}/uploads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error(`upload ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.files[0].url;
}

async function createItem(token, { title, description, valuePence, images }) {
  const res = await fetch(`${API}/items`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      description,
      category: "ELECTRONICS",
      condition: "GOOD",
      valuePence,
      images,
    }),
  });
  if (!res.ok) throw new Error(`create ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.item.id;
}

// Clean up fixtures from a previous run first.
const fixturesFile = new URL("./.fixtures.json", import.meta.url);
let previous = {};
try {
  previous = JSON.parse(fs.readFileSync(fixturesFile, "utf8"));
} catch {
  /* first run */
}
for (const id of Object.values(previous)) {
  if (typeof id !== "string" || !id.startsWith("cms")) continue;
  for (const token of [aliceToken, malloryToken]) {
    await fetch(`${API}/items/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }
}

const runId = Date.now().toString(36);
const targetTitle = `QA Target Item ${runId}`;
const offerLowTitle = `QA Offer Low ${runId}`;
const offerHighTitle = `QA Offer High ${runId}`;

const [aliceImg, malloryImg] = await Promise.all([uploadImage(aliceToken), uploadImage(malloryToken)]);

const targetId = await createItem(malloryToken, {
  title: targetTitle,
  description: "Deterministic QA fixture for the propose-swap flow.",
  valuePence: 200,
  images: [malloryImg],
});
const offerLowId = await createItem(aliceToken, {
  title: offerLowTitle,
  description: "Deterministic QA fixture with a zero gap against the target.",
  valuePence: 200,
  images: [aliceImg],
});
const offerHighId = await createItem(aliceToken, {
  title: offerHighTitle,
  description: "Deterministic QA fixture with a positive gap against the target.",
  valuePence: 10000,
  images: [aliceImg],
});

const fixtures = { targetId, offerLowId, offerHighId, targetTitle, offerLowTitle, offerHighTitle, runId, aliceToken, malloryToken };
fs.writeFileSync(new URL("./.fixtures.json", import.meta.url), JSON.stringify(fixtures, null, 2));
console.log("fixtures ready:", JSON.stringify({ targetId, offerLowId, offerHighId }));
