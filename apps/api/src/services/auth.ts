// Auth service — email+password hashing and API access-token issuing.
// Replaces the Cognito dependency: passwords are hashed with Node's built-in
// scrypt (no new dependency), and API access tokens are HMAC-SHA256 JWTs signed
// with the shared AUTH_SECRET. The web app calls /auth/login or /auth/signup and
// forwards the returned token as `Authorization: Bearer <token>`.

import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, createSecretKey, createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import { prisma, type User } from '@swapify/db';

type ScryptInput = string | Buffer;

function scryptAsync(
  password: ScryptInput,
  salt: ScryptInput,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

const ISSUER = 'swapify';
const AUDIENCE = 'swapify-api';
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days — matches the NextAuth session

function requireSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('FATAL: AUTH_SECRET must be set to a value of at least 32 characters.');
  }
  return secret;
}

/** `scrypt$N$r$p$salt$hash` */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(plain, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  const derived = await scryptAsync(plain, Buffer.from(saltHex, 'hex'), expected.length, {
    N,
    r,
    p,
    maxmem: SCRYPT.maxmem,
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function signAccessToken(user: Pick<User, 'id' | 'email' | 'name'>): Promise<string> {
  const key = createSecretKey(Buffer.from(requireSecret(), 'utf8'));
  return new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(key);
}

export const AUTH_CONSTANTS = { ISSUER, AUDIENCE } as const;

// ---------------------------------------------------------------------------
// Emailed one-time codes (email verification + password reset).
// Codes are 6 digits, stored as SHA-256 hashes, expire after 15 minutes, allow
// 5 attempts, and are single-use. Re-issuing invalidates prior live codes and
// is throttled to one send per minute per (user, purpose).
// ---------------------------------------------------------------------------

const CODE_TTL_MS = 15 * 60 * 1000;
const CODE_MAX_ATTEMPTS = 5;
const CODE_RESEND_COOLDOWN_MS = 60 * 1000;

export type EmailCodePurpose = 'EMAIL_VERIFY' | 'PASSWORD_RESET';

export function generateEmailCode(): string {
  return String(randomInt(100000, 1000000));
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** Issues a fresh code; returns the plaintext code (to email) or null when throttled. */
export async function issueEmailCode(
  userId: string,
  email: string,
  purpose: EmailCodePurpose,
): Promise<{ code: string } | { code: null }> {
  const latest = await prisma.emailCode.findFirst({
    where: { userId, purpose },
    orderBy: { createdAt: 'desc' },
  });
  if (latest && Date.now() - latest.createdAt.getTime() < CODE_RESEND_COOLDOWN_MS) {
    return { code: null };
  }
  await prisma.emailCode.updateMany({
    where: { userId, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  const code = generateEmailCode();
  await prisma.emailCode.create({
    data: {
      userId,
      email,
      purpose,
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });
  return { code };
}

export type ConsumeCodeResult = 'ok' | 'invalid' | 'expired' | 'attempts_exceeded';

/** Verifies and consumes the newest unconsumed code for (email, purpose). */
export async function consumeEmailCode(
  email: string,
  purpose: EmailCodePurpose,
  code: string,
): Promise<ConsumeCodeResult> {
  const normalized = code.trim();
  const record = await prisma.emailCode.findFirst({
    where: { email, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!record) return 'invalid';
  if (record.attempts >= CODE_MAX_ATTEMPTS) return 'attempts_exceeded';
  if (record.expiresAt.getTime() < Date.now()) return 'expired';

  const expected = Buffer.from(record.codeHash, 'hex');
  const actual = Buffer.from(hashCode(normalized), 'hex');
  const matches = expected.length === actual.length && timingSafeEqual(expected, actual);

  if (!matches) {
    await prisma.emailCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    return 'invalid';
  }

  await prisma.emailCode.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });
  return 'ok';
}
