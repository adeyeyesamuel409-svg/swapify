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
