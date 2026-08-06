"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession, signIn } from "next-auth/react";
import { createSwap, fetchMyItems, itemValue, type ApiItem } from "@/lib/api";

type Props = {
  itemId: string;
  itemValueTokens: number;
};

export default function SwapRequestButton({ itemId, itemValueTokens }: Props) {
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
        onClick={() => signIn("cognito")}
        className="mt-4 w-full rounded-md bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-500"
      >
        Sign in to request this swap
      </button>
    );
  }

  if (created) {
    return (
      <div className="mt-4 rounded-md border border-emerald-500/40 bg-emerald-950 p-4 text-sm text-emerald-200">
        Swap request sent! Awaiting the owner&apos;s decision.
        <Link href="/swaps" className="ml-2 font-semibold text-emerald-300 underline">
          View your swaps
        </Link>
      </div>
    );
  }

  const selected = myItems.find((i) => i.id === selectedId);
  const gap = selected
    ? Math.abs(itemValue(selected) - itemValueTokens)
    : null;
  const iPay = selected && itemValue(selected) < itemValueTokens;

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
    <div className="mt-6 rounded-xl border border-indigo-500/30 bg-indigo-950 p-4">
      <p className="text-sm font-semibold text-indigo-200">Swap for it</p>
      <p className="mt-1 text-xs text-indigo-400">Offer one of your own items. Value gaps are settled with tokens.</p>

      {myItems.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">
          You need an active listing to offer.{" "}
          <Link href="/post" className="text-indigo-300 underline">
            Post an item
          </Link>
        </p>
      ) : (
        <>
          <select
            className="mt-3 w-full rounded-md border border-indigo-500 bg-gray-800 px-3 py-2 text-white"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            <option value="">Choose an item to offer...</option>
            {myItems.map((i) => (
              <option key={i.id} value={i.id}>
                {i.title} ({itemValue(i)} tokens)
              </option>
            ))}
          </select>

          {selected && gap !== null && (
            <p className="mt-2 text-xs text-indigo-300">
              {gap === 0
                ? "Values match — no tokens needed."
                : iPay
                  ? `You'll pay the ${gap} token gap.`
                  : `The owner pays the ${gap} token gap to even it out.`}
            </p>
          )}

          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

          <button
            type="button"
            onClick={submit}
            disabled={!selectedId || submitting}
            className="mt-3 w-full rounded-md bg-indigo-600 px-4 py-2.5 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {submitting ? "Sending..." : "Request swap"}
          </button>
        </>
      )}
    </div>
  );
}
