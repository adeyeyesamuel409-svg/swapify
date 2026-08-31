import { chromium } from "playwright-core";
import { signInAs } from "./auth.mjs";
import { BASE } from "./helpers.mjs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: CHROME, headless: true });

try {
  const { page, errors } = await signInAs(
    browser,
    "upload-alice@swapify.test",
    "TestPass!2026a",
    { expectLanding: "/" },
  );
  console.log("landed on:", page.url());
  console.log("console/page errors:", errors.length ? errors : "none");

  // Confirm the session is actually set: header should show the user menu (no "Sign in" button).
  await page.goto(`${BASE}/browse`, { waitUntil: "networkidle" });
  const signInButtons = await page.getByRole("button", { name: /Sign in/i }).count();
  console.log("sign-in buttons still present after auth:", signInButtons);
  const headerText = await page.locator("header").innerText().catch(() => "");
  console.log("header has email:", headerText.includes("upload-alice@swapify.test"));
} finally {
  await browser.close();
}
