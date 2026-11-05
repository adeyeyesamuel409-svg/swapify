// Fails if source files contain mojibake (UTF-8 text that was misdecoded and
// re-encoded, e.g. "â€"" instead of an em-dash). Run: npm run check:encoding
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

if (bad > 0) {
  console.error(`\ncheck:encoding FAILED — ${bad} mojibake occurrence(s). Fix before shipping.`);
  process.exit(1);
}
console.log("check:encoding OK — no mojibake in source.");
