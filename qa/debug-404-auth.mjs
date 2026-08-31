import { chromium } from "playwright-core";
import { BASE } from "./helpers.mjs";
import { completeSignIn } from "./auth.mjs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const fours = new Set();

page.on("response", (r) => {
  if (r.status() === 404) fours.add(r.url());
});
page.on("console", (m) => {
  if (m.type() === "error") {
    console.log("[console-error]", m.text().slice(0, 160));
    const loc = m.location();
    if (loc?.url) console.log("   at", loc.url.slice(0, 140));
  }
});

await page.goto(`${BASE}/profile`, { waitUntil: "networkidle" });
await completeSignIn(page, "upload-alice@swapify.test", "TestPass!2026a");
await page.goto(`${BASE}/items/cmsjsu6ou0009i9gcaygvwxn4`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

console.log("=== 404 responses ===");
[...fours].forEach((u) => console.log(u));
await browser.close();
