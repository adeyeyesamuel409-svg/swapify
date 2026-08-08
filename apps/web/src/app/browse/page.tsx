import { fetchItems, type ApiItem } from "@/lib/api";
import { CATEGORIES, CONDITIONS, CATEGORY_LABELS, CONDITION_LABELS } from "@swapify/shared";
import Link from "next/link";
import ItemCard from "@/components/ItemCard";
import Button from "@/components/Button";
import { Search } from "lucide-react";

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; condition?: string }>;
}) {
  const params = await searchParams;
  const { items, total } = await fetchItems(params);

  const inputClass =
    "h-10 rounded-btn border border-line bg-surface-2 px-3 text-sm text-foreground placeholder:text-muted focus:border-primary/60 focus:outline-none";

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Browse listings</h1>
          <p className="mt-1 text-sm text-muted">
            Swap for what you need with people nearby — no cash required.
          </p>
        </div>
        <Button href="/post">
          <span aria-hidden>+</span> Post an item
        </Button>
      </div>

      <form method="get" className="mt-8 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            name="q"
            defaultValue={params.q}
            placeholder="Search items..."
            className={`${inputClass} w-full pl-9`}
          />
        </div>
        <select name="category" defaultValue={params.category ?? ""} className={inputClass}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <select name="condition" defaultValue={params.condition ?? ""} className={inputClass}>
          <option value="">Any condition</option>
          {CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {CONDITION_LABELS[c]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-10 rounded-btn bg-surface-3 px-4 text-sm font-semibold text-foreground transition-colors hover:border-primary/60 hover:bg-surface-2"
        >
          Filter
        </button>
      </form>

      <p className="mt-6 text-sm text-muted">
        {total} listing{total === 1 ? "" : "s"}
      </p>

      {items.length === 0 ? (
        <div className="mt-12 flex flex-col items-center gap-3 rounded-card border border-dashed border-line bg-surface/50 py-16 text-center">
          <p className="text-foreground">No listings match your filters.</p>
          <p className="text-sm text-muted">Try a different keyword, category, or condition.</p>
          <Link href="/browse" className="mt-2 text-sm font-semibold text-primary-soft hover:text-foreground">
            Clear filters
          </Link>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item: ApiItem) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </main>
  );
}
