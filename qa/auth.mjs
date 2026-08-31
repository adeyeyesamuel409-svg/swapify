import { chromium } from "playwright-core";
import { BASE } from "./helpers.mjs";

export { chromium };

// Finish sign-in starting from the app's /signin page (or a page that already
// redirected there with a callbackUrl). Mirrors a real user: fill email,
// Continue -> Cognito hosted UI -> sign in -> back to the app.
export async function completeSignIn(page, email, password) {
  const emailInput = page.locator("input[name=email]").first();
  await emailInput.waitFor({ state: "visible", timeout: 15000 });
  await emailInput.fill(email);
  await page.getByRole("button", { name: "Continue" }).click();

  // Hop through NextAuth's /api/auth/signin and land on the Cognito hosted UI.
  await page
    .waitForURL((u) => u.href.includes("amazoncognito.com"), { timeout: 45000 })
    .catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

  // The hosted UI renders a hidden template form alongside the live one, so
  // only interact with visible fields.
  const userField = page.locator('input[name="username"]:visible').first();
  if (await userField.isVisible().catch(() => false)) {
    const current = await userField.inputValue().catch(() => "");
    if (current !== email) await userField.fill(email);
  }

  const passField = page.locator('input[name="password"]:visible').first();
  await passField.waitFor({ state: "visible", timeout: 30000 });
  await passField.fill(password);
  await page.locator('input[name="signInSubmitButton"]:visible').first().click();

  await page.waitForURL((u) => !u.href.includes("amazoncognito.com"), { timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  return page.url().replace(BASE, "") || "/";
}

export async function signInAs(browser, email, password, { expectLanding } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto(`${BASE}/signin`, { waitUntil: "networkidle", timeout: 30000 });
  const landing = await completeSignIn(page, email, password);
  if (expectLanding !== undefined && landing !== expectLanding) {
    throw new Error(`expected to land on ${expectLanding}, got ${landing}`);
  }
  return { context, page, errors };
}
