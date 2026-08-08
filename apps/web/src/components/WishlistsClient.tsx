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

  const inputClass =
    "h-10 rounded-btn border border-line bg-surface-2 px-3 text-sm text-foreground placeholder:text-muted focus:border-primary/60 focus:outline-none";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Wishlists</h1>
      <p className="mt-2 text-muted">
        Tell Swapify what you want &mdash; we&apos;ll surface active listings that match.
      </p>

      {error && <p className="mt-4 text-sm text-rose-400">{error}</p>}

      <div className="mt-6 flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="What do you need? e.g. PS5 console"
            className={`${inputClass} flex-1`}
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputClass}
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
            className={`${inputClass} flex-1`}
          />
          <button
            type="button"
            disabled={busy || !title.trim()}
            onClick={create}
            className="rounded-btn bg-brand px-4 text-sm font-semibold text-white shadow-glow transition-all hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Saving..." : "Add to wishlist"}
          </button>
        </div>
      </div>

      {wishlists.length === 0 ? (
        <p className="mt-10 text-center text-muted">No wishlists yet. Add one above.</p>
      ) : (
        <div className="mt-8 flex flex-col gap-4">
          {wishlists.map((w) => (
            <div key={w.id} className="rounded-card border border-line bg-surface p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">{w.title}</p>
                  <p className="text-xs text-muted">
                    {w.category ? CATEGORY_LABELS[w.category as keyof typeof CATEGORY_LABELS] : "Any category"}
                    {w.maxValueMicroTokens ? ` · max ${Number(BigInt(w.maxValueMicroTokens)) / 1_000_000} tokens` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(w.id)}
                  className="text-xs text-rose-400 underline hover:text-rose-300"
                >
                  Remove
                </button>
              </div>

              {w.matches.length === 0 ? (
                <p className="mt-3 text-xs text-muted">No matching listings right now - check back soon.</p>
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {w.matches.map((item) => (
                    <Link
                      key={item.id}
                      href={`/items/${item.id}`}
                      className="rounded-btn border border-line bg-surface-2 p-3 transition-all duration-200 hover:border-primary/50 hover:bg-surface-3"
                    >
                      <p className="truncate text-sm font-semibold text-primary-soft">{item.title}</p>
                      <p className="mt-1 text-xs text-muted">
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
