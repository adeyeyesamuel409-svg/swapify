// One token = 1,000,000 micro-tokens. All stored amounts are integer
// micro-tokens so we never suffer floating-point rounding on money.
export const MICRO_TOKENS_PER_TOKEN = 1_000_000n;

export function tokensToMicroTokens(tokens: number | bigint): bigint {
  return BigInt(tokens) * MICRO_TOKENS_PER_TOKEN;
}

export function microTokensToTokens(microTokens: bigint | string): number {
  return Number(BigInt(microTokens)) / Number(MICRO_TOKENS_PER_TOKEN);
}

// Display metadata shared by the API and web app.
export const CATEGORIES = [
  'ELECTRONICS',
  'FURNITURE',
  'CLOTHING',
  'BOOKS',
  'GAMES',
  'TOOLS',
  'SPORTS',
  'HOME_KITCHEN',
  'COLLECTIBLES',
  'OTHER',
] as const;

export const CONDITIONS = ['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR'] as const;

export const CATEGORY_LABELS: Record<(typeof CATEGORIES)[number], string> = {
  ELECTRONICS: 'Electronics',
  FURNITURE: 'Furniture',
  CLOTHING: 'Clothing',
  BOOKS: 'Books',
  GAMES: 'Games',
  TOOLS: 'Tools',
  SPORTS: 'Sports',
  HOME_KITCHEN: 'Home & Kitchen',
  COLLECTIBLES: 'Collectibles',
  OTHER: 'Other',
};

export const CONDITION_LABELS: Record<(typeof CONDITIONS)[number], string> = {
  NEW: 'New',
  LIKE_NEW: 'Like new',
  GOOD: 'Good',
  FAIR: 'Fair',
  POOR: 'Poor',
};

export const SWAP_STATUS_LABELS: Record<string, string> = {
  REQUESTED: 'Requested',
  AGREED: 'Agreed',
  ESCROWED: 'Escrowed',
  SHIPPED: 'Shipped',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

export const GAP_PAYER_LABELS: Record<string, string> = {
  OFFERING_USER: 'Offering user',
  REQUESTING_USER: 'Requesting user',
  NONE: 'No gap',
};

// Token purchase tiers. The API is the authority on pricing; this list only
// drives what the UI shows and what tierId values are valid.
export const TOKEN_TIERS = [
  { id: 'starter', tokens: 50, priceCents: 500 },
  { id: 'regular', tokens: 150, priceCents: 1400 },
  { id: 'booster', tokens: 500, priceCents: 4000 },
  { id: 'power', tokens: 1200, priceCents: 8500 },
] as const;

export type TokenTier = (typeof TOKEN_TIERS)[number];

export const TOKEN_TIER_LABELS: Record<string, string> = {
  starter: 'Starter',
  regular: 'Regular',
  booster: 'Booster',
  power: 'Power',
};

export const TOKEN_ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  PAID: 'Paid',
  FAILED: 'Failed',
};

export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  SWAP_REQUEST: 'Swap request',
  SWAP_UPDATE: 'Swap update',
  MESSAGE: 'Message',
  RATING: 'Rating',
  ESCROW: 'Escrow',
  SYSTEM: 'System',
};

export const ITEM_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  RESERVED: 'Reserved',
  SWAPPED: 'Swapped',
  HIDDEN: 'Hidden',
  DELETED: 'Deleted',
};
