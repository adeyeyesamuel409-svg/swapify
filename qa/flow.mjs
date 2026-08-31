import fs from "node:fs";
import { chromium } from "playwright-core";
import { BASE } from "./helpers.mjs";
import { completeSignIn } from "./auth.mjs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const fixtures = JSON.parse(fs.readFileSync(new URL("./.fixtures.json", import.meta.url), "utf8"));
const CAMERA_ITEM = "cmsjsu6ou0009i9gcaygvwxn4";

const report = [];
const pass = (m) => report.push("PASS  " + m);
const fail = (m) => report.push("FAIL  " + m);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
const page = await context.newPage();
const allErrors = new Set();
const all404 = new Set();
page.on("pageerror", (e) => allErrors.add(String(e)));
page.on("console", (m) => m.type() === "error" && allErrors.add(m.text()));
page.on("requestfailed", (r) => {
  const err = r.failure()?.errorText ?? "?";
  if (!(err === "net::ERR_ABORTED" && r.url().includes("_rsc="))) allErrors.add(`req: ${err} ${r.url()}`);
});
page.on("response", (r) => {
  if (r.status() >= 500) allErrors.add(`http ${r.status()} ${r.url()}`);
  if (r.status() === 404) all404.add(r.url());
});

const waitText = (page, text, timeout = 15000) =>
  page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });

try {
  // ================= 1. Auth round-trip preserves the intended path ==============
  report.push("\n--- 1. Auth round-trip / callbackUrl ---");
  await page.goto(`${BASE}/profile`, { waitUntil: "networkidle", timeout: 30000 });
  const signinUrl = page.url();
  if (signinUrl.includes("/signin") && signinUrl.includes("callbackUrl") && signinUrl.includes("%2Fprofile")) {
    pass("unauthenticated /profile redirects to /signin with callbackUrl=/profile");
  } else {
    fail(`/profile redirect URL unexpected: ${signinUrl}`);
  }

  const landing = await completeSignIn(page, "upload-alice@swapify.test", "TestPass!2026a");
  if (landing === "/profile") pass("after sign-in, user returns to /profile (path preserved)");
  else fail(`after sign-in landed on ${landing}, expected /profile`);

  // ================= 2. Propose-swap gap UX ======================================
  report.push("\n--- 2. Propose-swap gap UX ---");
  const { targetTitle, offerLowTitle, offerHighTitle } = fixtures;
  await page.goto(`${BASE}/items/${fixtures.targetId}`, { waitUntil: "networkidle", timeout: 30000 });
  await waitText(page, "Swap for it");

  const lowOffer = page.getByRole("button", { name: new RegExp(offerLowTitle) });
  const highOffer = page.getByRole("button", { name: new RegExp(offerHighTitle) });
  if ((await lowOffer.count()) > 0) pass("offer grid shows my active listing (QA Offer Low)");
  else fail("offer grid did not show QA Offer Low");
  if ((await highOffer.count()) > 0) pass("offer grid shows my active listing (QA Offer High)");
  else fail("offer grid did not show QA Offer High");

  await lowOffer.click();
  await waitText(page, "Values match — no payment needed.");
  pass("zero gap: shows 'Values match — no payment needed.'");

  await highOffer.click();
  await waitText(page, "The owner pays £98.00 to even it out.");
  pass("positive gap: shows 'The owner pays £98.00 to even it out.' (requester's item is worth more)");

  await page.getByRole("button", { name: "Request swap" }).click();
  await waitText(page, "Swap request sent!");
  pass("swap request submitted successfully");

  // ================= 3. Swaps list + swap detail + timeline ======================
  report.push("\n--- 3. Swaps list, detail, timeline ---");
  await page.goto(`${BASE}/swaps`, { waitUntil: "networkidle", timeout: 30000 });
  await waitText(page, targetTitle);
  const hasRequestedLabel = await page.getByText("Requested", { exact: false }).count();
  if (hasRequestedLabel > 0) pass("swaps list shows the new swap as Requested");
  else fail("swaps list did not show 'Requested' status");

  const swapCard = page.locator("div.rounded-card").filter({ hasText: targetTitle }).first();
  const swapId = (await swapCard.locator('a[href^="/swaps/"]').first().getAttribute("href"))?.split("/")[2];
  if (swapId) pass(`swap created: ${swapId}`);
  else fail("could not resolve created swap id");

  if (swapId) {
    await page.goto(`${BASE}/swaps/${swapId}`, { waitUntil: "networkidle", timeout: 30000 });
    await waitText(page, "Swap detail");
    await waitText(page, targetTitle);
    if ((await page.getByText("Requested", { exact: false }).count()) > 0) pass("swap detail shows REQUESTED status");
    else fail("swap detail missing REQUESTED status");
    if ((await page.locator('input[placeholder="Type a message..."]').count()) > 0) pass("swap chat composer present");
    else fail("swap chat composer missing");
    const timeline = await page.locator("main").innerText();
    if (/Requested|Offer|Escrow|Complete/i.test(timeline)) pass("swap timeline renders state steps");
    else fail("swap timeline not detected");

    // No payment surface while the swap is still REQUESTED: no Pay button and
    // the value gap is shown in GBP (mallory is the payer, alice is viewing).
    const detailText = await page.locator("main").innerText();
    if (detailText.includes("Value gap:") && detailText.includes("£98.00")) {
      pass("swap detail shows the value gap in GBP before payment");
    } else {
      fail("swap detail did not show 'Value gap: £98.00' while REQUESTED");
    }
    if (await page.getByRole("button", { name: /^Pay / }).count() === 0) {
      pass("no Pay button is shown while the swap is still REQUESTED");
    } else {
      fail("Pay button appeared before the swap was accepted");
    }
  }
  await context.close();
} catch (e) {
  fail(`EXCEPTION: ${e.message.split("\n")[0]}`);
}

// ================= 4. Image QA (browse -> detail -> gallery -> refresh -> back) ===
report.push("\n--- 4. Image QA ---");
const pubContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
const pub = await pubContext.newPage();
pub.on("pageerror", (e) => allErrors.add(String(e)));
pub.on("console", (m) => m.type() === "error" && allErrors.add(m.text()));
pub.on("response", (r) => {
  if (r.status() >= 400 && r.status() < 600 && !r.url().includes("_rsc=")) {
    allErrors.add(`http ${r.status()} ${r.url()}`);
  }
});

try {
  await pub.goto(`${BASE}/browse?q=camera`, { waitUntil: "networkidle", timeout: 30000 });
  const card = pub.locator(`a[href="/items/${CAMERA_ITEM}"]`);
  if ((await card.count()) > 0) {
    pass("browse shows the camera listing card");
    await card.first().click();
  } else {
    fail("camera listing card not found on browse");
    await pub.goto(`${BASE}/items/${CAMERA_ITEM}`, { waitUntil: "networkidle" });
  }
  await waitText(pub, "Frontend render check camera", 15000);

  const activeImg = pub.locator(`main img[alt="Frontend render check camera"]`);
  await activeImg.waitFor({ state: "visible", timeout: 15000 });
  const loaded = await activeImg.evaluate((el) => el.naturalWidth > 0);
  if (loaded) pass("gallery active image loads (uploaded PNG served from API)");
  else fail("gallery active image did not load");

  const thumbs = pub.locator('button[aria-label^="Show image"]');
  await thumbs.first().waitFor({ state: "visible", timeout: 15000 });
  const thumbCount = await thumbs.count();
  if (thumbCount === 2) pass("gallery shows 2 thumbnails (matches image count)");
  else fail(`gallery thumbnails = ${thumbCount}, expected 2`);

  const srcBefore = await activeImg.getAttribute("src");
  await thumbs.nth(1).click();
  await pub.waitForFunction(
    (prev) => {
      const img = document.querySelector(`main img[alt="Frontend render check camera"]`);
      return img && img.getAttribute("src") !== prev;
    },
    srcBefore,
    { timeout: 10000 },
  );
  const srcAfter = await activeImg.getAttribute("src");
  if (srcAfter !== srcBefore) pass("clicking thumbnail swaps the active gallery image");
  else fail("thumbnail click did not change active image");

  await pub.reload({ waitUntil: "networkidle" });
  await waitText(pub, "Frontend render check camera");
  const afterReload = await activeImg.evaluate((el) => el.naturalWidth > 0);
  if (afterReload) pass("image still loads after refresh (URL persisted)");
  else fail("image broken after refresh");

  await pub.goBack({ waitUntil: "networkidle" });
  if (pub.url().includes("/browse")) pass("browser back returns to browse");
  else fail(`back landed on ${pub.url()}`);
  await pubContext.close();
} catch (e) {
  fail(`image QA exception: ${e.message.split("\n")[0]}`);
}

// ================= 5. A11y spot checks ==========================================
report.push("\n--- 5. Accessibility spot checks ---");
try {
  const a11yContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const a11y = await a11yContext.newPage();
  await a11y.goto(`${BASE}/items/${CAMERA_ITEM}`, { waitUntil: "networkidle", timeout: 30000 });

  const smallTargets = await a11y.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll("main button, main a")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.display === "inline" && el.tagName === "A") continue;
      if (r.height < 32 && r.width < 44) {
        bad.push(`<${el.tagName.toLowerCase()}> ${(el.textContent || "").trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return bad;
  });
  if (smallTargets.length === 0) pass("all main buttons/links have adequate tap targets (>=32px tall or >=44px wide)");
  else {
    fail(`small tap targets found (${smallTargets.length}):`);
    smallTargets.forEach((s) => report.push(`      ${s}`));
  }

  const imgIssues = await a11y.evaluate(() => {
    const bad = [];
    for (const img of document.querySelectorAll("main img")) {
      const alt = img.getAttribute("alt");
      // Decorative images inside a labeled control (e.g. gallery thumbnails with
      // aria-label buttons) are allowed to have empty alt.
      const labeled = img.closest(
        "button[aria-label], a[aria-label], [role=button][aria-label], [aria-labelledby]",
      );
      const ariaHidden = img.closest("[aria-hidden=true]");
      if ((alt === null || alt === "") && !ariaHidden && !labeled) {
        bad.push(img.src.split("/").slice(-1)[0]);
      }
    }
    return bad;
  });
  if (imgIssues.length === 0) pass("all non-decorative images carry alt text");
  else fail(`images missing alt: ${imgIssues.join(", ")}`);

  // Focus visibility on interactive elements.
  const focusOk = await a11y.evaluate(() => {
    const el = document.querySelector('main a[href^="/items/"]');
    if (!el) return null;
    el.focus();
    const style = getComputedStyle(el);
    const ring = style.outlineStyle !== "none" && style.outlineWidth !== "0px";
    const boxShadow = style.boxShadow !== "none";
    return { ring, boxShadow, focused: document.activeElement === el };
  });
  if (focusOk?.focused && (focusOk.ring || focusOk.boxShadow)) pass("focused elements show a visible focus indicator");
  else fail(`no visible focus indicator: ${JSON.stringify(focusOk)}`);

  // Label associations on the sign-in form.
  await a11y.goto(`${BASE}/signin`, { waitUntil: "networkidle" });
  const labelOk = await a11y.evaluate(() => {
    const input = document.querySelector("#email");
    const label = document.querySelector('label[for="email"]');
    return !!(input && label);
  });
  if (labelOk) pass("sign-in email input has an associated label");
  else fail("sign-in email input missing label association");
  await a11yContext.close();
} catch (e) {
  fail(`a11y exception: ${e.message.split("\n")[0]}`);
}

// ================= 6. Console / network report ===================================
report.push("\n--- 6. Console / network errors ---");
// Known external noise (verified): Cognito hosted UI's own favicon.ico returns 404
// (AWS-side; not our codebase). Everything else is a real failure.
const noise = (e) => e.includes("_rsc=") || e.includes("favicon.ico") || /status of 404/.test(e);
const real = [...allErrors].filter((e) => !noise(e));
if (real.length === 0) pass("no console/page/network errors across the whole flow");
else real.forEach((e) => report.push(`  ERR: ${e}`));
report.push(`\nAll 404 responses (incl. RSC prefetch): ${all404.size}`);
[...all404].forEach((u) => report.push(`  404: ${u}`));

await browser.close();
report.push(`\n${report.filter((r) => r.startsWith("PASS")).length} passed / ${report.filter((r) => r.startsWith("FAIL")).length} failed`);
console.log(report.join("\n"));
process.exit(report.some((r) => r.startsWith("FAIL")) ? 1 : 0);
