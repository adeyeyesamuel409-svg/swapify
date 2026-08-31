import { chromium } from "playwright-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

await page.goto("http://localhost:3000/signin", { waitUntil: "networkidle" });
await page.locator("input[name=email]").fill("upload-alice@swapify.test");
await page.getByRole("button", { name: "Continue" }).click();
await page.waitForURL((u) => u.href.includes("amazoncognito.com"), { timeout: 45000 });
await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

console.log("hosted UI URL:", page.url().slice(0, 160));
const info = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll("input")].map((i) => ({
    name: i.name, id: i.id, type: i.type,
    visible: !!(i.offsetParent !== null && getComputedStyle(i).visibility !== "hidden"),
    rect: (() => { const r = i.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
  }));
  const buttons = [...document.querySelectorAll("button")].map((b) => ({
    text: (b.innerText || b.textContent || "").trim().slice(0, 40),
    visible: !!(b.offsetParent !== null),
    type: b.type,
  }));
  const formIds = [...document.querySelectorAll("form")].map((f) => f.id || f.name || "anon");
  return { inputs, buttons, formIds, hasWasm: !!window.WebAssembly };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
