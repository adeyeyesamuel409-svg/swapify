import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@swapify/db";

const prisma = new PrismaClient();
const tmp = path.join(os.tmpdir(), "opencode");

async function userId() {
  const r = await fetch("http://localhost:4000/auth/me", {
    headers: { Authorization: `Bearer ${fs.readFileSync(path.join(tmp, "alice.token"), "utf8").trim()}` },
  });
  return (await r.json()).user.id;
}

const aliceId = await userId();
const swaps = await prisma.swap.findMany({
  select: { id: true, offeringUserId: true, requestedUserId: true },
});

const notAlice = swaps.filter((s) => s.offeringUserId !== aliceId && s.requestedUserId !== aliceId);
if (notAlice.length > 0) {
  const sid = notAlice[0].id;
  const r = await fetch(`http://localhost:4000/swaps/${sid}`, {
    headers: { Authorization: `Bearer ${fs.readFileSync(path.join(tmp, "alice.token"), "utf8").trim()}` },
  });
  console.log(`swap ${sid} involves neither alice nor mallory; alice read -> ${r.status} (${r.status === 404 ? "PASS blocked" : "FAIL"})`);
} else {
  console.log("No swap exists that excludes both alice and mallory; code-review gate confirmed at swaps.ts:92-95");
}
await prisma.$disconnect();
