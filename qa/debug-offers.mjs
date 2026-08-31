import fs from "node:fs";
import { chromium } from "playwright-core";
import { BASE } from "./helpers.mjs";
import { completeSignIn } from "./auth.mjs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const fixtures = JSON.parse(fs.readFileSync(new URL("./.fixtures.json", import.meta.url), "utf8"));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

await page.goto(`${BASE}/signin`, { waitUntil: "networkidle" });
await completeSignIn(page, "upload-alice@swapify.test", "TestPass!2026a");

await page.goto(`${BASE}/items/${fixtures.targetId}`, { waitUntil: "networkidle" });
await page.getByText("Swap for it").waitFor({ state: "visible" });

const low = page.getByRole("button", { name: /QA Offer Low/ }).first();
const high = page.getByRole("button", { name: /QA Offer High/ }).first();

const dump = async (label) => {
  const info = await page.evaluate(() => {
    const els = [...document.querySelectorAll("button")];
    return els.map((b) => {
      const r = b.getBoundingClientRect();
      const style = getComputedStyle(b);
      return {
        text: (b.innerText || "").trim().slice(0, 40),
        w: Math.round(r.width), h: Math.round(r.height),
        top: Math.round(r.top), bottom: Math.round(r.bottom),
        disabled: b.disabled,
        pointerEvents: style.pointerEvents,
      };
    }).filter((b) => b.text.includes("QA") || b.text === "Request swap");
  });
  console.log(label, JSON.stringify(info, null, 1));
};

await dump("BEFORE");
await low.click();
await page.getByText("Values match — no payment needed.").waitFor({ state: "visible" });
await dump("AFTER LOW");
console.log("high count:", await high.count());
const r = await high.boundingBox();
console.log("high bbox:", JSON.stringify(r));
const over = await page.evaluate((sel) => {
  const el = document.querySelector("button");
  return null;
}, null);
try {
  await high.click({ timeout: 8000 });
  console.log("high click OK");
} catch (e) {
  console.log("high click failed:", e.message.split("\n")[0]);
  await page.screenshot({ path: "qa/screenshots/debug-offers.png" });
  const headerBox = await page.locator("header").boundingBox();
  console.log("header bbox:", JSON.stringify(headerBox));
  const atPoint = await page.evaluate((x, y) => {
    const el = document.elementFromPoint(x, y);
    return el ? `${el.tagName}${el.className ? "." + String(el.className).split(" ").slice(0, 2).join(".") : ""}` : "null";
  }, r.x + r.width / 2, r.y + r.height / 2);
  console.log("element at high-center:", atPoint);
}
await browser.close();
