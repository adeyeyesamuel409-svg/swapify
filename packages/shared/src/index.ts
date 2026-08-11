// All money amounts are stored as integer GBP pence (1 pound = 100 pence),
// the same way Stripe stores money in its minor units. The API never uses
// floats for money; decimals only appear at the edge for display.

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
  PAID: 'Paid',
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

// Service fee: a flat percentage of the item being acquired, in GBP pence.
// £50.00 item -> £2.50. Centralized so the rate can change in one place.
export const SERVICE_FEE_RATE = 0.05;

export function calculateServiceFee(itemValuePence: number): number {
  return Math.round(itemValuePence * SERVICE_FEE_RATE);
}

// Formats integer pence as a display string: 5250 -> "£52.50".
export function formatPence(pence: number | bigint | string): string {
  return `£${(Number(pence) / 100).toFixed(2)}`;
}

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
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
