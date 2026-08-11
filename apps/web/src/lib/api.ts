const API_URL = process.env.API_URL ?? "http://localhost:4000";

// Public base used to resolve relative image keys (uploads/<uuid>.<ext>).
// Local development falls back to the API (which serves the files). In
// production point this at the CloudFront distribution (see .env.example).
const IMAGE_BASE_URL = process.env.NEXT_PUBLIC_IMAGE_BASE_URL ?? API_URL;

// All money is integer GBP pence; format as £X.XX for display.
export function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

export type ApiUser = {
  id: string;
  email: string;
  name: string;
  bio: string | null;
  imageUrl: string | null;
  admin: { role: string } | null;
};

export type ApiItem = {
  id: string;
  title: string;
  description: string;
  category: string;
  condition: string;
  valuePence: number;
  status: string;
  createdAt: string;
  images: { id: string; url: string }[];
  owner: { id: string; name: string; imageUrl: string | null; createdAt: string };
};

export type ListItemsResult = {
  items: ApiItem[];
  total: number;
  page: number;
  pageSize: number;
};

export async function apiFetch<T>(path: string, accessToken?: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`API request failed: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

// Listing images are stored as portable relative object keys (uploads/<file>)
// produced by the upload pipeline, or absolute external URLs (legacy
// listings). Relative keys are resolved against the configured image base so
// the same database value works in dev (API origin) and production (CDN).
export function resolveImageUrl(url: string): string {
  if (!url) return url;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;
  return `${IMAGE_BASE_URL}${url.startsWith("/") ? url : `/${url}`}`;
}

// Upload images as multipart. Returns relative URLs to attach to an item.
export async function uploadImages(accessToken: string, files: File[]): Promise<{ url: string }[]> {
  const form = new FormData();
  for (const file of files) form.append("images", file);

  const res = await fetch(`${API_URL}/uploads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
    cache: "no-store",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? `Upload failed: ${res.status}`);
  }

  const data = (await res.json()) as { files: { url: string }[] };
  return data.files;
}

export function fetchMe(accessToken: string): Promise<{ user: ApiUser }> {
  return apiFetch("/auth/me", accessToken);
}

export function fetchItems(
  filters?: {
    q?: string;
    category?: string;
    condition?: string;
    sort?: "newest" | "value_asc" | "value_desc";
    page?: number;
    pageSize?: number;
  },
): Promise<ListItemsResult> {
  const params = new URLSearchParams();
  if (filters?.q) params.set("q", filters.q);
  if (filters?.category) params.set("category", filters.category);
  if (filters?.condition) params.set("condition", filters.condition);
  if (filters?.sort) params.set("sort", filters.sort);
  if (filters?.page) params.set("page", String(filters.page));
  if (filters?.pageSize) params.set("pageSize", String(filters.pageSize));
  const qs = params.toString();
  return apiFetch(`/items${qs ? `?${qs}` : ""}`);
}

export function fetchItem(id: string): Promise<{ item: ApiItem }> {
  return apiFetch(`/items/${id}`);
}

export async function createItem(
  accessToken: string,
  input: {
    title: string;
    description: string;
    category: string;
    condition: string;
    valuePence: number;
    images: string[];
  },
): Promise<{ item: ApiItem }> {
  const res = await fetch(`${API_URL}/items`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? `API ${res.status}`);
  }

  return res.json();
}

export function itemValuePence(item: ApiItem): number {
  return item.valuePence;
}

export function timeAgo(dateValue: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateValue).getTime()) / 1000);
  if (Number.isNaN(seconds) || seconds < 0) return "recently";
  const units: [number, string][] = [
    [31536000, "y"],
    [2592000, "mo"],
    [604800, "w"],
    [86400, "d"],
    [3600, "h"],
    [60, "m"],
  ];
  for (const [size, label] of units) {
    if (seconds >= size) {
      const value = Math.floor(seconds / size);
      return `${value}${label} ago`;
    }
  }
  return "just now";
}

export type ApiSwap = {
  id: string;
  status: string;
  gapPence: number;
  gapPayer: string;
  offeringUserId: string;
  requestedUserId: string;
  offeringUserConfirmedAt: string | null;
  requestedUserConfirmedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  offeringItem: ApiItem;
  requestedItem: ApiItem;
  offeringUser: { id: string; name: string; imageUrl: string | null };
  requestedUser: { id: string; name: string; imageUrl: string | null };
  payment: {
    id: string;
    status: string;
    amountPence: number;
    feePence: number;
    totalPence: number;
    paidAt: string | null;
  } | null;
};

export function fetchSwaps(accessToken: string): Promise<{ swaps: ApiSwap[] }> {
  return apiFetch("/swaps", accessToken);
}

export function fetchSwap(accessToken: string, id: string): Promise<{ swap: ApiSwap }> {
  return apiFetch(`/swaps/${id}`, accessToken);
}

async function apiSend(
  path: string,
  accessToken: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? `API ${res.status}`);
  }

  return res.json();
}

export function createSwap(
  accessToken: string,
  input: { offeringItemId: string; requestedItemId: string },
): Promise<{ swap: ApiSwap }> {
  return apiSend("/swaps", accessToken, "POST", input) as Promise<{ swap: ApiSwap }>;
}

export function acceptSwap(accessToken: string, swapId: string): Promise<{ swap: ApiSwap }> {
  return apiSend(`/swaps/${swapId}/accept`, accessToken, "POST") as Promise<{ swap: ApiSwap }>;
}

export function declineSwap(accessToken: string, swapId: string): Promise<{ swap: ApiSwap }> {
  return apiSend(`/swaps/${swapId}/decline`, accessToken, "POST") as Promise<{ swap: ApiSwap }>;
}

export function cancelSwap(accessToken: string, swapId: string): Promise<{ swap: ApiSwap }> {
  return apiSend(`/swaps/${swapId}/cancel`, accessToken, "POST") as Promise<{ swap: ApiSwap }>;
}

// Starts the gap payment. Returns the checkout URL to navigate to (Stripe
// Checkout in production, the API's simulated dev-confirm flow otherwise).
export function paySwap(
  accessToken: string,
  swapId: string,
): Promise<{ swap: ApiSwap; checkoutUrl: string }> {
  return apiSend(`/swaps/${swapId}/pay`, accessToken, "POST") as Promise<{ swap: ApiSwap; checkoutUrl: string }>;
}

export function confirmSwap(accessToken: string, swapId: string): Promise<{ swap: ApiSwap }> {
  return apiSend(`/swaps/${swapId}/confirm`, accessToken, "POST") as Promise<{ swap: ApiSwap }>;
}

// Soft-deletes the caller's listing. Rejected with 409 while the item is part
// of an in-progress swap.
export function deleteItem(accessToken: string, itemId: string): Promise<{ item: ApiItem }> {
  return apiSend(`/items/${itemId}`, accessToken, "DELETE") as Promise<{ item: ApiItem }>;
}

// --- Chat ---------------------------------------------------------------

export type ApiMessage = {
  id: string;
  swapId: string;
  senderId: string;
  body: string;
  createdAt: string;
  sender: { id: string; name: string; imageUrl: string | null };
};

export function fetchMessages(accessToken: string, swapId: string): Promise<{ messages: ApiMessage[] }> {
  return apiFetch(`/swaps/${swapId}/messages`, accessToken);
}

export function sendMessage(
  accessToken: string,
  swapId: string,
  body: string,
): Promise<{ message: ApiMessage }> {
  return apiSend(`/swaps/${swapId}/messages`, accessToken, "POST", { body }) as Promise<{ message: ApiMessage }>;
}

// --- Ratings ------------------------------------------------------------

export type ApiRating = {
  id: string;
  swapId: string;
  raterId: string;
  rateeId: string;
  score: number;
  comment: string | null;
  createdAt: string;
  rater: { id: string; name: string; imageUrl: string | null };
};

export function rateSwap(
  accessToken: string,
  swapId: string,
  input: { score: number; comment?: string },
): Promise<{ rating: ApiRating }> {
  return apiSend(`/swaps/${swapId}/rating`, accessToken, "POST", input) as Promise<{ rating: ApiRating }>;
}

export function fetchUserRatings(userId: string): Promise<{ ratings: ApiRating[]; averageScore: number | null; total: number }> {
  return apiFetch(`/users/${userId}/ratings`);
}

export type ApiUserProfile = {
  user: { id: string; name: string; imageUrl: string | null; bio: string | null; createdAt: string };
  rating: { averageScore: number | null; total: number };
  completedSwaps: number;
};

export function fetchUserProfile(userId: string): Promise<ApiUserProfile> {
  return apiFetch(`/users/${userId}`);
}

export function fetchSwapRatings(accessToken: string, swapId: string): Promise<{ ratings: ApiRating[] }> {
  return apiFetch(`/swaps/${swapId}/ratings`, accessToken);
}

// --- Wishlists ----------------------------------------------------------

export type ApiWishlist = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  maxValuePence: number | null;
  createdAt: string;
};

export function fetchWishlists(accessToken: string): Promise<{ wishlists: ApiWishlist[] }> {
  return apiFetch("/wishlists", accessToken);
}

export function createWishlist(
  accessToken: string,
  input: { title: string; description?: string; category?: string; maxValuePence?: number },
): Promise<{ wishlist: ApiWishlist }> {
  return apiSend("/wishlists", accessToken, "POST", input) as Promise<{ wishlist: ApiWishlist }>;
}

export function deleteWishlist(accessToken: string, id: string): Promise<unknown> {
  return apiSend(`/wishlists/${id}`, accessToken, "DELETE") as Promise<unknown>;
}

export function fetchWishlistMatches(
  accessToken: string,
  id: string,
): Promise<{ matches: ApiItem[] }> {
  return apiFetch(`/wishlists/${id}/matches`, accessToken);
}

// --- Notifications ------------------------------------------------------

export type ApiNotification = {
  id: string;
  type: string;
  body: string;
  read: boolean;
  referenceId: string | null;
  createdAt: string;
};

export function fetchNotifications(accessToken: string): Promise<{ notifications: ApiNotification[] }> {
  return apiFetch("/notifications", accessToken);
}

export function fetchUnreadCount(accessToken: string): Promise<{ count: number }> {
  return apiFetch("/notifications/unread-count", accessToken);
}

export function markNotificationRead(accessToken: string, id: string): Promise<{ notification: ApiNotification }> {
  return apiSend(`/notifications/${id}/read`, accessToken, "POST") as Promise<{ notification: ApiNotification }>;
}

export function markAllNotificationsRead(accessToken: string): Promise<{ updated: number }> {
  return apiSend("/notifications/read-all", accessToken, "POST") as Promise<{ updated: number }>;
}

// --- Admin --------------------------------------------------------------

export type AdminStats = {
  users: number;
  items: number;
  swaps: number;
  activeSwaps: number;
  paidSwaps: number;
  totalFeesPence: number;
};

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  admin: { role: string } | null;
  _count: { items: number; swapsOffered: number; swapsRequested: number; paymentsMade: number };
};

export function fetchAdminStats(accessToken: string): Promise<{ stats: AdminStats }> {
  return apiFetch("/admin/stats", accessToken);
}

export function fetchAdminUsers(accessToken: string): Promise<{ users: AdminUser[] }> {
  return apiFetch("/admin/users", accessToken);
}

export function fetchAdminListings(accessToken: string): Promise<{ items: ApiItem[] }> {
  return apiFetch("/admin/listings", accessToken);
}

export function setItemStatus(
  accessToken: string,
  itemId: string,
  status: string,
): Promise<{ item: ApiItem }> {
  return apiSend(`/admin/items/${itemId}/status`, accessToken, "POST", { status }) as Promise<{ item: ApiItem }>;
}

export function fetchMyItems(accessToken: string): Promise<ListItemsResult> {
  return apiFetch("/items/me", accessToken);
}
