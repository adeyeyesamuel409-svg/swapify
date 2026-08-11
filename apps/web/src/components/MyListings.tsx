"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteItem, fetchMyItems, formatPence, type ApiItem } from "@/lib/api";
import ItemImage from "@/components/ItemImage";
import { ITEM_STATUS_LABELS } from "@swapify/shared";
import { Trash2 } from "lucide-react";

export default function MyListings({ accessToken }: { accessToken: string }) {
  const router = useRouter();
  const [items, setItems] = useState<ApiItem[] | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchMyItems(accessToken)
      .then(({ items }) => setItems(items))
      .catch(() => setItems([]));
  }, [accessToken]);

  const remove = async (itemId: string, title: string) => {
    if (!window.confirm(`Delete "${title}"? This removes the listing from the marketplace.`)) return;
    setDeletingId(itemId);
    setError("");
    try {
      await deleteItem(accessToken, itemId);
      setItems((prev) => (prev ?? []).filter((i) => i.id !== itemId));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete this listing");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="rounded-card border border-line bg-surface p-6">
      <h2 className="text-sm font-semibold text-foreground">My listings</h2>

      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}

      {items === null ? (
        <p className="mt-3 text-sm text-muted">Loading your listings...</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          No active listings yet.{" "}
          <Link href="/post" className="font-semibold text-primary-soft underline">
            Post an item
          </Link>
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 rounded-btn border border-line bg-surface-2 p-2.5">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-btn border border-line bg-surface">
                {item.images[0] ? (
                  <ItemImage src={item.images[0].url} alt={item.title} />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] text-muted">No photo</div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <Link href={`/items/${item.id}`} className="block truncate text-sm font-semibold text-foreground hover:text-primary-soft">
                  {item.title}
                </Link>
                <p className="text-xs text-muted">
                  {formatPence(item.valuePence)} · {ITEM_STATUS_LABELS[item.status] ?? item.status}
                </p>
              </div>
              <button
                type="button"
                disabled={deletingId === item.id}
                onClick={() => remove(item.id, item.title)}
                title="Delete listing"
                aria-label={`Delete listing ${item.title}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-btn border border-rose-500/40 text-rose-300 transition-colors hover:bg-rose-950 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
