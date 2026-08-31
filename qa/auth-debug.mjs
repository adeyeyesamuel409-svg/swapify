import { chromium } from "playwright-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on("console", (m) => console.log("[console]", m.type(), m.text().slice(0, 200)));
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
page.on("requestfailed", (r) => console.log("[failed]", r.url().slice(0, 120), r.failure()?.errorText));

await page.goto("http://localhost:3100/signin", { waitUntil: "networkidle" });
console.log("signin page URL:", page.url());
await page.locator("input[name=email]").fill("upload-alice@swapify.test");
await page.getByRole("button", { name: "Continue" }).click();
await page.waitForTimeout(4000);
console.log("after Continue URL:", page.url());
console.log("title:", await page.title());
const html = await page.content();
console.log("has amazoncognito:", html.includes("amazoncognito"));
console.log("body snippet:", html.replace(/\s+/g, " ").slice(0, 600));
await page.screenshot({ path: "qa/screenshots/debug-auth.png" });
await browser.close();
