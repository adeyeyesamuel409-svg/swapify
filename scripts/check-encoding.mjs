// Fails if source files contain mojibake (UTF-8 text that was misdecoded and
// re-encoded, e.g. "â€"" instead of an em-dash) or if the brand mark assets
// lose their known-good signatures (guards against text-surgery corruption).
// Run: npm run check:encoding
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["apps", "packages"];
const EXT = /\.(ts|tsx|js|mjs|css|json|prisma|sql)$/;
const MOJIBAKE = /â€[\u00a0-\uffff]|Â[\u00a0-\uffff]|Ã[\u00a0-\uffff]/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next" || name === "dist") continue;
      walk(p, out);
    } else if (EXT.test(name)) {
      out.push(p);
    }
  }
  return out;
}

let bad = 0;
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const text = readFileSync(file, "utf8");
    const hits = text.match(MOJIBAKE);
    if (hits) {
      bad += hits.length;
      const line = text.split("\n").findIndex((l) => MOJIBAKE.test(l)) + 1;
      console.log(`MOJIBAKE ${file}:${line} (${hits.length} occurrence(s))`);
    }
  }
}

// Brand-asset signatures: the swap-arrows mark must keep its exact geometry and
// approved colors in both the header logo component and the favicon.
const BRAND_CHECKS = [
  {
    file: "apps/web/src/components/SwapIcon.tsx",
    mustContain: ["M31 37", "rotate(180 32 32)", "#F12A7B", "#3B4A6B"],
  },
  {
    file: "apps/web/src/app/icon.svg",
    mustContain: ["M31 37", "rotate(180 32 32)", "#F12A7B", "#3B4A6B"],
  },
];
for (const check of BRAND_CHECKS) {
  const text = readFileSync(check.file, "utf8");
  for (const needle of check.mustContain) {
    if (!text.includes(needle)) {
      bad += 1;
      console.log(`BRAND_DRIFT ${check.file}: missing "${needle}"`);
    }
  }
}

if (bad > 0) {
  console.error(`\ncheck:encoding FAILED — ${bad} problem(s). Fix before shipping.`);
  process.exit(1);
}
console.log("check:encoding OK — no mojibake, brand assets intact.");
