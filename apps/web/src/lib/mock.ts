// Deterministic mock data for design-only signals the API does not provide yet
// (proximity distance, seller trust scores, trade preference). Values are hashed
// from stable ids so server and client render identically (no hydration drift).
// Replace with real API fields when geo/trust features land.

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** e.g. "0.8 mi" */
export function mockProximity(id: string): string {
  const miles = 0.2 + (hashString(`p:${id}`) % 46) / 10;
  return `${miles.toFixed(1)} mi`;
}

/** e.g. { rating: "4.9", swaps: 32 } */
export function mockTrust(id: string): { rating: string; swaps: number } {
  const h = hashString(`t:${id}`);
  return {
    rating: (4.2 + (h % 8) / 10).toFixed(1),
    swaps: 6 + (h % 60),
  };
}

/** Seller trade preference overlay tag. */
export function mockTradePreference(id: string): "trades" | "cash" {
  return hashString(`x:${id}`) % 3 === 0 ? "cash" : "trades";
}

/**
 * Seller verification flags (design-only UI signals). Shown as trust badges
 * while the product is pre-launch; wire to real verification fields (ID check,
 * account verification) before public launch — badges must never out-run the
 * facts.
 */
export function mockVerification(id: string): { verified: boolean; idVerified: boolean } {
  const h = hashString(`v:${id}`);
  return {
    verified: h % 10 < 7,
    idVerified: h % 10 < 5,
  };
}
