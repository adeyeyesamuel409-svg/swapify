// One-time favicon rasterization: renders src/app/icon.svg to PNGs.
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const svg = readFileSync("C:/Users/SAdey/AppData/Local/Temp/opencode/r335a-baseline/apps/web/src/app/icon.svg");
const jobs = [
  { out: "apps/web/src/app/apple-icon.png", size: 180 },
  { out: "apps/web/public/apple-touch-icon.png", size: 180 },
  { out: "apps/web/public/favicon-32.png", size: 32 },
  { out: "apps/web/public/favicon-16.png", size: 16 },
];
for (const job of jobs) {
  const buf = await sharp(svg, { density: 300 }).resize(job.size, job.size).png().toBuffer();
  writeFileSync(`C:/Users/SAdey/AppData/Local/Temp/opencode/r335a-baseline/${job.out}`, buf);
  console.log(`WROTE ${job.out} (${buf.length} bytes)`);
}
