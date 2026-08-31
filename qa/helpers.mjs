import { chromium } from "playwright-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
export const BASE = process.env.QA_BASE ?? "http://localhost:3100";

export const VIEWPORTS = [
  { name: "375x812", width: 375, height: 812 },
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
];

export async function launch(headless = true) {
  return chromium.launch({ executablePath: CHROME, headless });
}

export async function openPage(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const collected = { console: [], pageErrors: [], failed: [], responses: [] };
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      collected.console.push({ type: msg.type(), text: msg.text() });
    }
  });
  page.on("pageerror", (err) => collected.pageErrors.push(String(err)));
  page.on("requestfailed", (req) =>
    collected.failed.push({ url: req.url(), failure: req.failure()?.errorText ?? "?" }),
  );
  page.on("response", (res) => {
    const url = res.url();
    if (res.status() >= 400 && !url.startsWith("data:")) {
      collected.responses.push({ status: res.status(), url });
    }
  });
  return { page, context, collected };
}

// Returns any element whose bounding box escapes the viewport horizontally.
export async function findHOverflow(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const bad = [];
    const all = document.querySelectorAll("body *");
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > vw + 2 || r.left < -2) {
        const style = getComputedStyle(el);
        const fixed = style.position === "fixed" || style.position === "sticky";
        if (fixed && (r.width >= vw - 4 || r.left <= 0)) continue;
        const id = el.id ? `#${el.id}` : "";
        const cls = typeof el.className === "string" ? `.${el.className.split(" ").slice(0, 2).join(".")}` : "";
        bad.push({
          tag: el.tagName.toLowerCase(),
          id,
          cls: cls.slice(0, 80),
          left: Math.round(r.left),
          right: Math.round(r.right),
          vw,
        });
      }
    }
    const htmlOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
    return { htmlOverflow, bad };
  });
}

export async function stickyHeaderOverlap(page) {
  return page.evaluate(() => {
    const header = document.querySelector("header");
    if (!header) return null;
    const hr = header.getBoundingClientRect();
    const main = document.querySelector("main");
    if (!main) return { headerBottom: Math.round(hr.bottom) };
    const mr = main.getBoundingClientRect();
    return {
      headerBottom: Math.round(hr.bottom),
      mainTop: Math.round(mr.top),
      overlap: mr.top < hr.bottom,
      headerPosition: getComputedStyle(header).position,
    };
  });
}
