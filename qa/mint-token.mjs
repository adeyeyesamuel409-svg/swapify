import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CLIENT_ID = "318efovratuirgr33rqu7t65a6";
const CLIENT_SECRET = "viuphdqk1git95lrdaluln8ntli1aump57qeuk26v3fe6eqrt99";
const POOL_ID = "us-east-1_fU6u35nHI";

function secretHash(username) {
  return createHmac("sha256", CLIENT_SECRET).update(username + CLIENT_ID).digest("base64");
}

async function mint(email, password, outFile) {
  const sh = secretHash(email);
  const args = [
    "cognito-idp", "admin-initiate-auth",
    "--user-pool-id", POOL_ID,
    "--client-id", CLIENT_ID,
    "--auth-flow", "ADMIN_USER_PASSWORD_AUTH",
    "--auth-parameters", `USERNAME=${email},PASSWORD=${password},SECRET_HASH=${sh}`,
    "--output", "json",
  ];
  const raw = execSync(`aws ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`, { encoding: "utf8" });
  const json = JSON.parse(raw);
  const token = json.AuthenticationResult?.AccessToken;
  if (!token) throw new Error(`no AccessToken for ${email}: ${raw.slice(0, 300)}`);
  fs.writeFileSync(path.join(os.tmpdir(), "opencode", outFile), token);
  console.log(`${email}: token minted -> ${outFile}`);
}

const [email, password, out] = process.argv.slice(2);
await mint(email, password, out);
