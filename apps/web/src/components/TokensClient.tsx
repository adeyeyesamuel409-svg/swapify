"use client";

import { useEffect, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { createCheckoutSession, fetchTokenOrders, type ApiTokenOrder } from "@/lib/api";
import { TOKEN_TIERS, TOKEN_ORDER_STATUS_LABELS } from "@swapify/shared";

export default function TokensClient({ paid }: { paid: boolean }) {
  const { data: session, status } = useSession();
  const [orders, setOrders] = useState<ApiTokenOrder[]>([]);
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (session?.accessToken) {
      fetchTokenOrders(session.accessToken)
        .then(({ orders }) => setOrders(orders))
        .catch(() => setError("Could not load order history"));
    }
  }, [session?.accessToken]);

  if (status === "loading") return <p className="mx-auto mt-20 text-gray-400">Loading...</p>;

  if (!session?.accessToken) {
    return (
      <main className="mx-auto max-w-xl flex-1 px-6 py-16 text-center">
        <h1 className="text-2xl font-bold text-white">Buy tokens</h1>
        <p className="mt-2 text-gray-400">
          <button onClick={() => signIn("cognito")} className="text-indigo-400 hover:underline">
            Sign in
          </button>{" "}
          to buy tokens for swapping.
        </p>
      </main>
    );
  }

  const buy = async (tierId: string) => {
    setError("");
    setBuying(tierId);
    try {
      const { url } = await createCheckoutSession(session.accessToken!, {
        tierId,
        successUrl: `${window.location.origin}/tokens?paid=1`,
        cancelUrl: `${window.location.origin}/tokens`,
      });
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start checkout");
      setBuying(null);
    }
  };

  return (
    <main className="mx-auto max-w-3xl flex-1 px-6 py-12">
      <h1 className="text-3xl font-bold text-white">Buy tokens</h1>
      <p className="mt-2 text-gray-400">Tokens balance value gaps when you swap. Buy once, keep swapping.</p>

      {paid && (
        <div className="mt-6 rounded-md border border-emerald-500/40 bg-emerald-950 p-4 text-sm text-emerald-200">
          Payment complete - tokens added to your wallet.
        </div>
      )}
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {TOKEN_TIERS.map((tier) => (
          <div key={tier.id} className="rounded-xl border border-gray-700 bg-gray-800 p-6">
            <p className="text-lg font-semibold text-white">{tier.tokens} tokens</p>
            <p className="mt-1 text-sm text-gray-400">
              ${(tier.priceCents / 100).toFixed(2)} &middot; ${(tier.priceCents / 100 / tier.tokens).toFixed(3)}/token
            </p>
            <button
              type="button"
              disabled={buying !== null}
              onClick={() => buy(tier.id)}
              className="mt-4 w-full rounded-md bg-indigo-600 px-4 py-2.5 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {buying === tier.id ? "Starting checkout..." : "Buy"}
            </button>
          </div>
        ))}
      </div>

      {orders.length > 0 && (
        <div className="mt-12">
          <h2 className="text-xl font-bold text-white">Purchase history</h2>
          <div className="mt-4 overflow-hidden rounded-xl border border-gray-700">
            {orders.map((order) => (
              <div key={order.id} className="flex items-center justify-between border-b border-gray-700 bg-gray-800 px-4 py-3 last:border-b-0">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {Number(BigInt(order.tokens)).toLocaleString()} tokens
                  </p>
                  <p className="text-xs text-gray-500">
                    ${(order.priceCents / 100).toFixed(2)} &middot; {new Date(order.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span className={`rounded-full border px-3 py-0.5 text-xs font-semibold ${order.status === "PAID" ? "border-emerald-500/40 bg-emerald-950 text-emerald-300" : "border-gray-600 bg-gray-900 text-gray-400"}`}>
                  {TOKEN_ORDER_STATUS_LABELS[order.status] ?? order.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
