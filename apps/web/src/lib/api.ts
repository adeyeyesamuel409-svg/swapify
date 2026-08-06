const API_URL = process.env.API_URL ?? "http://localhost:4000";

export type ApiUser = {
  id: string;
  email: string;
  name: string;
  bio: string | null;
  imageUrl: string | null;
  wallet: { balanceMicroTokens: string } | null;
};

export type ApiItem = {
  id: string;
  title: string;
  description: string;
  category: string;
  condition: string;
  valueMicroTokens: string;
  status: string;
  createdAt: string;
  images: { id: string; url: string }[];
  owner: { id: string; name: string; imageUrl: string | null };
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

export type ApiWallet = {
  id: string;
  balanceMicroTokens: string;
  version: number;
  createdAt: string;
};

export type ApiTransaction = {
  id: string;
  type: string;
  direction: string;
  amountMicroTokens: string;
  balanceAfterMicroTokens: string;
  referenceId: string | null;
  note: string | null;
  createdAt: string;
};

export type WalletResult = { wallet: ApiWallet; transactions: ApiTransaction[] };

export function fetchWallet(accessToken: string): Promise<WalletResult> {
  return apiFetch("/wallet", accessToken);
}

export function fetchMe(accessToken: string): Promise<{ user: ApiUser }> {
  return apiFetch("/auth/me", accessToken);
}

export function fetchItems(
  filters?: { q?: string; category?: string; condition?: string; page?: number },
): Promise<ListItemsResult> {
  const params = new URLSearchParams();
  if (filters?.q) params.set("q", filters.q);
  if (filters?.category) params.set("category", filters.category);
  if (filters?.condition) params.set("condition", filters.condition);
  if (filters?.page) params.set("page", String(filters.page));
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
    valueTokens: number;
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

export function itemValue(item: ApiItem): number {
  return Number(BigInt(item.valueMicroTokens)) / 1_000_000;
}

export type ApiSwap = {
  id: string;
  status: string;
  gapMicroTokens: string;
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
  escrow: {
    id: string;
    status: string;
    amountMicroTokens: string;
    walletId: string;
    heldAt: string;
    releasedAt: string | null;
    refundedAt: string | null;
  } | null;
};

export function fetchSwaps(accessToken: string): Promise<{ swaps: ApiSwap[] }> {
  return apiFetch("/swaps", accessToken);
}

async function apiSend(
  path: string,
  accessToken: string,
  method: "POST" | "PATCH",
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

export function fundSwap(accessToken: string, swapId: string): Promise<{ swap: ApiSwap }> {
  return apiSend(`/swaps/${swapId}/fund`, accessToken, "POST") as Promise<{ swap: ApiSwap }>;
}

export function confirmSwap(accessToken: string, swapId: string): Promise<{ swap: ApiSwap }> {
  return apiSend(`/swaps/${swapId}/confirm`, accessToken, "POST") as Promise<{ swap: ApiSwap }>;
}

export function fetchMyItems(accessToken: string): Promise<ListItemsResult> {
  return apiFetch("/items/me", accessToken);
}
