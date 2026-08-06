import { fetchItems, itemValue, type ApiItem } from "@/lib/api";
import { CATEGORY_LABELS, CONDITION_LABELS, CATEGORIES, CONDITIONS } from "@swapify/shared";
import Link from "next/link";

function ItemCard({ item }: { item: ApiItem }) {
  const img = item.images[0]?.url;
  return (
    <Link
      href={`/items/${item.id}`}
      className="group overflow-hidden rounded-xl border border-gray-700 bg-gray-800 transition hover:border-indigo-500"
    >
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt={item.title} className="h-48 w-full object-cover" />
      ) : (
        <div className="flex h-48 w-full items-center justify-center bg-gray-900 text-sm text-gray-500">
          No photo
        </div>
      )}
      <div className="p-4">
        <p className="text-xs text-indigo-400">{CATEGORY_LABELS[item.category as keyof typeof CATEGORY_LABELS] ?? item.category}</p>
        <h3 className="mt-1 font-semibold text-white group-hover:text-indigo-300">{item.title}</h3>
        <div className="mt-2 flex items-center justify-between text-sm">
          <span className="text-gray-400">{CONDITION_LABELS[item.condition as keyof typeof CONDITION_LABELS] ?? item.condition}</span>
          <span className="font-semibold text-white">{itemValue(item)} tokens</span>
        </div>
      </div>
    </Link>
  );
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; condition?: string }>;
}) {
  const params = await searchParams;
  const { items, total } = await fetchItems(params);

  return (
    <main className="mx-auto max-w-6xl flex-1 px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Browse listings</h1>
        <Link
          href="/post"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          + Post an item
        </Link>
      </div>

      <form method="get" className="mt-6 flex flex-wrap gap-3">
        <input
          name="q"
          defaultValue={params.q}
          placeholder="Search items..."
          className="rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-white placeholder:text-gray-500"
        />
        <select name="category" defaultValue={params.category ?? ""} className="rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-white">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
        <select name="condition" defaultValue={params.condition ?? ""} className="rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-white">
          <option value="">Any condition</option>
          {CONDITIONS.map((c) => (
            <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
          ))}
        </select>
        <button type="submit" className="rounded-md bg-gray-700 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-600">
          Filter
        </button>
      </form>

      <p className="mt-6 text-sm text-gray-400">{total} listing{total === 1 ? "" : "s"}</p>

      {items.length === 0 ? (
        <p className="mt-10 text-gray-400">No listings match. Try a different filter.</p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </main>
  );
}
