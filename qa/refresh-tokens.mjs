// Refresh auth tokens for QA test users by signing in via Cognito hosted UI.
// Saves Cognito access tokens to $TEMP/opencode/{alice,mallory}.token.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.QA_BASE ?? "http://localhost:3000";
const tmp = path.join(os.tmpdir(), "opencode");

const users = [
  { email: "upload-alice@swapify.test", password: "TestPass!2026a", file: "alice.token" },
  { email: "upload-mallory@swapify.test", password: "TestPass!2026a", file: "mallory.token" },
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

for (const user of users) {
  console.log(`Signing in as ${user.email}...`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();

  await page.goto(`${BASE}/signin`, { waitUntil: "networkidle", timeout: 30000 });

  const emailInput = page.locator("input[name=email]").first();
  await emailInput.waitFor({ state: "visible", timeout: 15000 });
  await emailInput.fill(user.email);
  await page.getByRole("button", { name: "Continue" }).click();

  await page.waitForURL((u) => u.href.includes("amazoncognito.com"), { timeout: 45000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

  const userField = page.locator('input[name="username"]:visible').first();
  if (await userField.isVisible().catch(() => false)) {
    const current = await userField.inputValue().catch(() => "");
    if (current !== user.email) await userField.fill(user.email);
  }

  const passField = page.locator('input[name="password"]:visible').first();
  await passField.waitFor({ state: "visible", timeout: 30000 });
  await passField.fill(user.password);
  await page.locator('input[name="signInSubmitButton"]:visible').first().click();

  await page.waitForURL((u) => !u.href.includes("amazoncognito.com"), { timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Extract the Cognito access token from the NextAuth session
  const sessionRes = await page.evaluate(async () => {
    const res = await fetch("/api/auth/session");
    return res.json();
  });

  if (sessionRes?.accessToken) {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, user.file), sessionRes.accessToken);
    console.log(`  OK: token saved to ${user.file}`);
  } else {
    console.error(`  FAILED: no accessToken in session for ${user.email}`);
    console.log("  Session:", JSON.stringify(sessionRes).slice(0, 300));
  }

  await context.close();
}

await browser.close();
console.log("Done.");
