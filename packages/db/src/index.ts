import { PrismaClient } from '@prisma/client';

// Re-export so consumers can import types from a single package.
export * from '@prisma/client';

// PrismaClient is intentionally a singleton: creating one per request would
// exhaust database connections at 1M users. In dev, Next.js hot-reloads
// modules, so we stash it on globalThis to survive reloads.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// BigInt does not serialize to JSON by default. Money/token amounts are BigInt,
// so every JSON response that includes them must use this replacer.
export function jsonWithBigInt(data: unknown): string {
  return JSON.stringify(data, (_key: string, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}
