import { chromium } from "playwright-core";
import { BASE } from "./helpers.mjs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const CAMERA_ITEM = "cmsjsu6ou0009i9gcaygvwxn4";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const fours = new Set();
page.on("response", (r) => {
  if (r.status() === 404) fours.add(r.url());
});
page.on("console", (m) => m.type() === "error" && console.log("[console]", m.text()));

await page.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page.click(`a[href="/items/${CAMERA_ITEM}"]`);
await page.waitForLoadState("networkidle");
await page.waitForTimeout(2000);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page.goBack({ waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page.goForward({ waitUntil: "networkidle" });
await page.waitForTimeout(2000);

console.log("=== 404 responses ===");
[...fours].forEach((u) => console.log(u));
await browser.close();
