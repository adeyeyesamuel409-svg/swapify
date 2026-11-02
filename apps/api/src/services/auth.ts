// Auth service — email+password hashing and API access-token issuing.
// Replaces the Cognito dependency: passwords are hashed with Node's built-in
// scrypt (no new dependency), and API access tokens are HMAC-SHA256 JWTs signed
// with the shared AUTH_SECRET. The web app calls /auth/login or /auth/signup and
// forwards the returned token as `Authorization: Bearer <token>`.

import { randomBytes, scrypt as scryptCb, timingSafeEqual, createSecretKey } from 'node:crypto';
import { SignJWT } from 'jose';
import type { User } from '@swapify/db';

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
