import { chromium } from "playwright-core";
import { BASE, VIEWPORTS, openPage, findHOverflow, stickyHeaderOverlap } from "./helpers.mjs";
import fs from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SCREENSHOTS = new URL("./screenshots/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
fs.mkdirSync(SCREENSHOTS, { recursive: true });

// Real pages to exercise. auth-required pages are covered unauthenticated too
// (they redirect to /signin, which is itself a valid check).
const PAGES = [
  { name: "home", path: "/" },
  { name: "browse", path: "/browse" },
  { name: "browse-filters", path: "/browse?q=camera&sort=value_desc" },
  { name: "listing-detail", path: "/items/cmsjsu6ou0009i9gcaygvwxn4" },
  { name: "listing-detail-noimage", path: "/items/cmshoazdj000bi99cuvny8mqt" },
  { name: "post", path: "/post" },
  { name: "signin", path: "/signin" },
  { name: "profile-redirect", path: "/profile" },
  { name: "wishlists-redirect", path: "/wishlists" },
  { name: "swaps-redirect", path: "/swaps" },
  { name: "admin-redirect", path: "/admin" },
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

const results = [];

for (const pageDef of PAGES) {
  for (const vp of VIEWPORTS) {
    const { page, context, collected } = await openPage(browser, vp);
    const errors = [];
    const label = `${pageDef.name}@${vp.name}`;

    let status = 0;
    let finalUrl = "";
    try {
      const res = await page.goto(`${BASE}${pageDef.path}`, { waitUntil: "networkidle", timeout: 25000 });
      status = res?.status() ?? 0;
      finalUrl = page.url().replace(BASE, "");
    } catch (e) {
      errors.push(`goto: ${e.message.split("\n")[0]}`);
    }

    // Let any lazy images/hydration settle.
    await page.waitForTimeout(500);

    const overflow = await findHOverflow(page).catch(() => ({ htmlOverflow: false, bad: [] }));
    const sticky = await stickyHeaderOverlap(page).catch(() => null);

    const consoleErrors = collected.console.filter((c) => c.type === "error").map((c) => c.text);
    const consoleWarnings = collected.console
      .filter((c) => c.type === "warning")
      .map((c) => c.text)
      .filter((t) => t && !t.startsWith("Use of history.pushState") && !t.includes("autofocus"));
    const pageErrors = collected.pageErrors;
    // RSC prefetch payloads aborted by client-side redirects are expected noise.
    const failed = collected.failed.filter(
      (f) => !(f.failure === "net::ERR_ABORTED" && f.url.includes("_rsc=")),
    );
    const badResponses = collected.responses.filter((r) => r.status >= 500);
    // 4xx resource responses that surface as console "Failed to load resource" noise.
    const fourHundreds = collected.responses.filter((r) => r.status >= 400 && r.status < 500);

    const shot = `${SCREENSHOTS}${pageDef.name}-${vp.name}.png`;
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});

    const over = !!overflow?.htmlOverflow;
    results.push({
      label,
      status,
      finalUrl,
      overflow: over,
      overflowEls: (overflow?.bad ?? []).slice(0, 3),
      htmlOverflow: !!overflow?.htmlOverflow,
      sticky,
      consoleErrors: [...new Set(consoleErrors)].slice(0, 3),
      consoleWarnings: [...new Set(consoleWarnings)].slice(0, 3),
      pageErrors: pageErrors.slice(0, 2),
      failed: failed.slice(0, 3),
      badResponses: badResponses.slice(0, 3),
      fourHundreds: fourHundreds.slice(0, 3),
    });

    await context.close();
  }
}

// ---- Report ----
const report = [];
report.push(`=== RESPONSIVE QA (${results.length} page×viewport runs) ===`);

const overflowPages = results.filter((r) => r.overflow);
const errorPages = results.filter((r) => r.consoleErrors.length || r.pageErrors.length || r.failed.length || r.badResponses.length || r.fourHundreds.length);

report.push(`Real horizontal page scroll (htmlOverflow): ${overflowPages.length}`);
for (const r of overflowPages) report.push(`  ${r.label} (status ${r.status}, -> ${r.finalUrl})`);

const clippedOrbs = results.filter((r) => !r.overflow && (r.overflowEls?.length ?? 0) > 0);
report.push(`Offscreen decorative elements (no page scroll, clipped by overflow-hidden): ${clippedOrbs.length}`);
for (const r of clippedOrbs) {
  for (const el of r.overflowEls) report.push(`  ${r.label} <${el.tag}${el.id}${el.cls}> left=${el.left} right=${el.right}`);
}

const redirectPages = results.filter((r) => r.status >= 300 && r.status < 400);
report.push(`Server redirects: ${redirectPages.length}`);
for (const r of redirectPages) report.push(`  ${r.label}: ${r.status} -> ${r.finalUrl}`);

report.push(`Console/page errors, failed requests, 500s, 4xx resources: ${errorPages.length}`);
for (const r of errorPages) {
  report.push(`  ${r.label}:`);
  for (const c of r.consoleErrors) report.push(`      console.error: ${c}`);
  for (const c of r.pageErrors) report.push(`      pageerror: ${c}`);
  for (const f of r.failed) report.push(`      failed: ${f.failure} ${f.url}`);
  for (const f of r.badResponses) report.push(`      ${f.status}: ${f.url}`);
  for (const f of r.fourHundreds) report.push(`      ${f.status}: ${f.url}`);
}

const landed = results.filter((r) => r.status < 400 && r.finalUrl && r.finalUrl !== "/" && r.finalUrl !== r.label.split("@")[0] && !r.label.startsWith("home"));
report.push(`Runs that landed on a different path than requested (client-side redirect): ${landed.length}`);
for (const r of landed) report.push(`  ${r.label}: requested ${r.label.split("@")[0]} -> landed ${r.finalUrl}`);

const warnings = results.filter((r) => r.consoleWarnings.length);
report.push(`Console warnings (may be dev/build noise): ${warnings.length}`);
for (const r of warnings.slice(0, 10)) {
  for (const w of r.consoleWarnings) report.push(`  ${r.label}: ${w}`);
}

const stickyIssues = results.filter((r) => r.sticky?.overlap);
report.push(`Header/main overlap: ${stickyIssues.length}`);
for (const r of stickyIssues) report.push(`  ${r.label}: ${JSON.stringify(r.sticky)}`);

fs.writeFileSync(new URL("./responsive-report.txt", import.meta.url), report.join("\n"), "utf8");
console.log(report.join("\n"));
await browser.close().catch(() => {});
process.exit(0);
