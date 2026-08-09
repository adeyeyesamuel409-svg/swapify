"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession, signIn } from "next-auth/react";
import { createSwap, fetchMyItems, itemValue, type ApiItem } from "@/lib/api";
import ItemImage from "@/components/ItemImage";
import { ArrowRight, Check, ImageOff } from "lucide-react";

type Props = {
  itemId: string;
  itemTitle: string;
  itemValueTokens: number;
};

export default function SwapRequestButton({ itemId, itemTitle, itemValueTokens }: Props) {
  const { data: session, status } = useSession();
  const [myItems, setMyItems] = useState<ApiItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (session?.accessToken) {
      fetchMyItems(session.accessToken)
        .then(({ items }) => setMyItems(items.filter((i) => i.status === "ACTIVE")))
        .catch(() => setError("Could not load your items"));
    }
  }, [session?.accessToken]);

  if (status === "loading") return null;

  if (!session?.accessToken) {
    return (
      <button
        type="button"
        onClick={() => signIn(undefined, { callbackUrl: window.location.pathname + window.location.search })}
        className="mt-4 w-full rounded-btn bg-brand px-4 py-3 font-semibold text-white shadow-glow transition-all hover:brightness-110"
      >
        Sign in to request this swap
      </button>
    );
  }

  if (created) {
    return (
      <div className="mt-4 rounded-card border border-emerald-500/40 bg-emerald-950 p-4 text-sm text-emerald-200">
        Swap request sent! Awaiting the owner&apos;s decision.
        <Link href="/swaps" className="ml-2 font-semibold text-emerald-300 underline">
          View your swaps
        </Link>
      </div>
    );
  }

  const selected = myItems.find((i) => i.id === selectedId);
  const gap = selected ? Math.abs(itemValue(selected) - itemValueTokens) : null;
  const iPay = selected ? itemValue(selected) < itemValueTokens : null;

  const submit = async () => {
    setError("");
    setSubmitting(true);
    try {
      const { swap } = await createSwap(session.accessToken!, {
        offeringItemId: selectedId,
        requestedItemId: itemId,
      });
      setCreated(swap.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send swap request");
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-6 rounded-card border border-primary/30 bg-primary/10 p-4">
      <p className="text-sm font-semibold text-primary-soft">Swap for it</p>
      <p className="mt-1 text-xs text-muted">Offer one of your own items. Value gaps are settled with tokens.</p>

      {myItems.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          You need an active listing to offer.{" "}
          <Link href="/post" className="text-primary-soft underline">
            Post an item
          </Link>
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {myItems.map((i) => {
              const active = selectedId === i.id;
              return (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => setSelectedId(active ? "" : i.id)}
                  aria-pressed={active}
                  className={`group relative overflow-hidden rounded-btn border bg-surface text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                    active ? "border-primary ring-2 ring-primary/30" : "border-line hover:border-primary/50"
                  }`}
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-surface-2">
                    {i.images[0] ? (
                      <ItemImage src={i.images[0].url} alt={i.title} />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted">
                        <ImageOff className="h-5 w-5 opacity-60" aria-hidden />
                      </div>
                    )}
                    {active && (
                      <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white">
                        <Check className="h-3 w-3" aria-hidden />
                      </span>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="truncate text-xs font-medium text-foreground">{i.title}</p>
                    <p className="text-[11px] text-token">{itemValue(i)} tokens</p>
                  </div>
                </button>
              );
            })}
          </div>

          {selected && gap !== null && iPay !== null && (
            <div className="mt-3 rounded-btn border border-line bg-surface-2 p-3">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] text-muted">You offer</p>
                  <p className="truncate text-sm font-semibold text-foreground">{selected.title}</p>
                  <p className="text-xs text-token">{itemValue(selected)} tokens</p>
                </div>
                <ArrowRight className="h-5 w-5 shrink-0 text-primary-soft" aria-hidden />
                <div className="min-w-0 text-right">
                  <p className="text-[11px] text-muted">Their item</p>
                  <p className="truncate text-sm font-semibold text-foreground">{itemTitle}</p>
                  <p className="text-xs text-token">{itemValueTokens} tokens</p>
                </div>
              </div>
              <p className="mt-2 border-t border-line pt-2 text-xs text-primary-soft">
                {gap === 0
                  ? "Values match — no tokens needed."
                  : iPay
                    ? `You'll pay the ${gap} token gap.`
                    : `The owner pays the ${gap} token gap to even it out.`}
              </p>
            </div>
          )}

          {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}

          <button
            type="button"
            onClick={submit}
            disabled={!selectedId || submitting}
            className="mt-3 w-full rounded-btn bg-brand px-4 py-2.5 font-semibold text-white shadow-glow transition-all hover:brightness-110 disabled:opacity-50"
          >
            {submitting ? "Sending..." : "Request swap"}
          </button>
        </>
      )}
    </div>
  );
}
