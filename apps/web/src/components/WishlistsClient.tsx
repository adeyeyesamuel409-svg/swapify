"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CATEGORIES, CATEGORY_LABELS } from "@swapify/shared";
import {
  createWishlist,
  deleteWishlist,
  itemValue,
  type ApiItem,
  type ApiWishlist,
} from "@/lib/api";

type Props = {
  wishlists: (ApiWishlist & { matches: ApiItem[] })[];
  accessToken: string;
};

export default function WishlistsClient({ wishlists, accessToken }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [maxValueTokens, setMaxValueTokens] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError("");
    try {
      await createWishlist(accessToken, {
        title: title.trim(),
        ...(category ? { category } : {}),
        ...(maxValueTokens ? { maxValueTokens: Number(maxValueTokens) } : {}),
      });
      setTitle("");
      setMaxValueTokens("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save wishlist");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteWishlist(accessToken, id);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <main className="mx-auto max-w-3xl flex-1 px-6 py-12">
      <h1 className="text-3xl font-bold text-white">Wishlists</h1>
      <p className="mt-2 text-gray-400">
        Tell Swapify what you want &mdash; we&apos;ll surface active listings that match.
      </p>

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      <div className="mt-6 flex flex-col gap-3 rounded-xl border border-gray-700 bg-gray-800 p-4">
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="What do you need? e.g. PS5 console"
            className="flex-1 rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white placeholder:text-gray-500"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border border-gray-600 bg-gray-900 px-2 py-2 text-sm text-white"
          >
            <option value="">Any category</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <input
            value={maxValueTokens}
            onChange={(e) => setMaxValueTokens(e.target.value)}
            type="number"
            min="0"
            placeholder="Max value in tokens (optional)"
            className="flex-1 rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white placeholder:text-gray-500"
          />
          <button
            type="button"
            disabled={busy || !title.trim()}
            onClick={create}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? "Saving..." : "Add to wishlist"}
          </button>
        </div>
      </div>

      {wishlists.length === 0 ? (
        <p className="mt-10 text-center text-gray-500">No wishlists yet. Add one above.</p>
      ) : (
        <div className="mt-8 flex flex-col gap-4">
          {wishlists.map((w) => (
            <div key={w.id} className="rounded-xl border border-gray-700 bg-gray-800 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-white">{w.title}</p>
                  <p className="text-xs text-gray-500">
                    {w.category ? CATEGORY_LABELS[w.category as keyof typeof CATEGORY_LABELS] : "Any category"}
                    {w.maxValueMicroTokens ? ` · max ${Number(BigInt(w.maxValueMicroTokens)) / 1_000_000} tokens` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(w.id)}
                  className="text-xs text-red-400 underline hover:text-red-300"
                >
                  Remove
                </button>
              </div>

              {w.matches.length === 0 ? (
                <p className="mt-3 text-xs text-gray-500">No matching listings right now - check back soon.</p>
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {w.matches.map((item) => (
                    <Link
                      key={item.id}
                      href={`/items/${item.id}`}
                      className="rounded-lg border border-gray-700 bg-gray-900 p-3 hover:border-indigo-500"
                    >
                      <p className="truncate text-sm font-semibold text-indigo-300">{item.title}</p>
                      <p className="mt-1 text-xs text-gray-400">
                        {itemValue(item)} tokens · {item.owner.name}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
