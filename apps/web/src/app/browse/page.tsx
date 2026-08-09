import { fetchItems, type ApiItem } from "@/lib/api";
import { CATEGORIES, CONDITIONS, CATEGORY_LABELS, CONDITION_LABELS } from "@swapify/shared";
import Link from "next/link";
import ItemCard from "@/components/ItemCard";
import Button from "@/components/Button";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

const PAGE_SIZE = 20;

type SortValue = "newest" | "value_asc" | "value_desc";

function toSort(value: string | undefined): SortValue {
  return value === "value_asc" || value === "value_desc" ? value : "newest";
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; condition?: string; sort?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const sort = toSort(params.sort);

  const filters = {
    q: params.q,
    category: params.category,
    condition: params.condition,
    sort,
    page,
    pageSize: PAGE_SIZE,
  };

  let items: ApiItem[] = [];
  let total = 0;
  let loadError = "";
  try {
    ({ items, total } = await fetchItems(filters));
  } catch {
    loadError = "We couldn't load listings right now.";
  }

  const inputClass =
    "h-10 rounded-btn border border-line bg-surface-2 px-3 text-sm text-foreground placeholder:text-muted focus:border-primary/60 focus:outline-none";

  const buildHref = (overrides: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams();
    if (params.q) next.set("q", params.q);
    if (params.category) next.set("category", params.category);
    if (params.condition) next.set("condition", params.condition);
    const activeSort = overrides.sort ?? sort;
    if (activeSort && activeSort !== "newest") next.set("sort", String(activeSort));
    if (overrides.page !== undefined) next.set("page", String(overrides.page));
    const qs = next.toString();
    return `/browse${qs ? `?${qs}` : ""}`;
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
        <select name="sort" defaultValue={sort} className={inputClass}>
          <option value="newest">Newest first</option>
          <option value="value_desc">Highest value</option>
          <option value="value_asc">Lowest value</option>
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
        {totalPages > 1 && ` · page ${page} of ${totalPages}`}
      </p>

      {loadError ? (
        <div className="mt-12 flex flex-col items-center gap-3 rounded-card border border-rose-500/40 bg-rose-950/30 py-16 text-center">
          <p className="text-foreground">{loadError}</p>
          <p className="text-sm text-muted">Please try again in a moment.</p>
        </div>
      ) : items.length === 0 ? (
        <div className="mt-12 flex flex-col items-center gap-3 rounded-card border border-dashed border-line bg-surface/50 py-16 text-center">
          <p className="text-foreground">No listings match your filters.</p>
          <p className="text-sm text-muted">Try a different keyword, category, or condition.</p>
          <Link href="/browse" className="mt-2 text-sm font-semibold text-primary-soft hover:text-foreground">
            Clear filters
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((item: ApiItem) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>

          {totalPages > 1 && (
            <nav
              className="mt-10 flex items-center justify-between gap-4"
              aria-label="Pagination"
            >
              {page > 1 ? (
                <Link
                  href={buildHref({ page: page - 1 })}
                  className="inline-flex items-center gap-1.5 rounded-btn border border-line bg-surface-2 px-3.5 py-2 text-sm font-semibold text-foreground transition-colors hover:border-primary/60 hover:bg-surface-3"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                  Previous
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-btn border border-line px-3.5 py-2 text-sm font-semibold text-muted opacity-60">
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                  Previous
                </span>
              )}

              <p className="text-sm text-muted">
                Page <span className="font-semibold text-foreground">{page}</span> of {totalPages}
              </p>

              {page < totalPages ? (
                <Link
                  href={buildHref({ page: page + 1 })}
                  className="inline-flex items-center gap-1.5 rounded-btn border border-line bg-surface-2 px-3.5 py-2 text-sm font-semibold text-foreground transition-colors hover:border-primary/60 hover:bg-surface-3"
                >
                  Next
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-btn border border-line px-3.5 py-2 text-sm font-semibold text-muted opacity-60">
                  Next
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </span>
              )}
            </nav>
          )}
        </>
      )}
    </main>
  );
}
