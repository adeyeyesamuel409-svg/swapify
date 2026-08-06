const API_URL = process.env.API_URL ?? "http://localhost:4000";

export type ApiUser = {
  id: string;
  email: string;
  name: string;
  bio: string | null;
  imageUrl: string | null;
  wallet: { balanceMicroTokens: string } | null;
};

// Calls the Swapify API with the user's Cognito access token.
export async function apiFetch<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`API request failed: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

export async function fetchMe(accessToken: string): Promise<{ user: ApiUser }> {
  return apiFetch("/auth/me", accessToken);
}
