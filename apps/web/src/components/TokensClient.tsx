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

  if (status === "loading") return <p className="mx-auto mt-20 text-muted">Loading...</p>;

  if (!session?.accessToken) {
    return (
      <main className="mx-auto max-w-xl flex-1 px-6 py-16 text-center">
        <h1 className="text-2xl font-bold text-foreground">Buy tokens</h1>
        <p className="mt-2 text-muted">
          <button onClick={() => signIn("cognito", { callbackUrl: window.location.pathname })} className="text-primary-soft hover:underline">
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
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Buy tokens</h1>
      <p className="mt-2 text-muted">Tokens balance value gaps when you swap. Buy once, keep swapping.</p>

      {paid && (
        <div className="mt-6 rounded-card border border-emerald-500/40 bg-emerald-950 p-4 text-sm text-emerald-200">
          Payment complete - tokens added to your wallet.
        </div>
      )}
      {error && <p className="mt-4 text-sm text-rose-400">{error}</p>}

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {TOKEN_TIERS.map((tier) => (
          <div key={tier.id} className="rounded-card border border-line bg-surface p-6 shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-primary/40">
            <p className="text-lg font-semibold text-foreground">{tier.tokens} tokens</p>
            <p className="mt-1 text-sm text-muted">
              ${(tier.priceCents / 100).toFixed(2)} &middot; ${(tier.priceCents / 100 / tier.tokens).toFixed(3)}/token
            </p>
            <button
              type="button"
              disabled={buying !== null}
              onClick={() => buy(tier.id)}
              className="mt-4 w-full rounded-btn bg-brand px-4 py-2.5 font-semibold text-white shadow-glow transition-all hover:brightness-110 disabled:opacity-50"
            >
              {buying === tier.id ? "Starting checkout..." : "Buy"}
            </button>
          </div>
        ))}
      </div>

      {orders.length > 0 && (
        <div className="mt-12">
          <h2 className="text-xl font-bold text-foreground">Purchase history</h2>
          <div className="mt-4 overflow-hidden rounded-card border border-line">
            {orders.map((order) => (
              <div key={order.id} className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 last:border-b-0">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {Number(BigInt(order.tokens)).toLocaleString()} tokens
                  </p>
                  <p className="text-xs text-muted">
                    ${(order.priceCents / 100).toFixed(2)} &middot; {new Date(order.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span className={`rounded-pill border px-3 py-0.5 text-xs font-semibold ${order.status === "PAID" ? "border-emerald-500/40 bg-emerald-950 text-emerald-300" : "border-line bg-surface-2 text-muted"}`}>
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
