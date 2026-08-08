import type { ApiItem } from "@/lib/api";
import ItemCard from "../ItemCard";
import SectionHeader from "../SectionHeader";

export default function FeaturedSection({ items }: { items: ApiItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <SectionHeader
        eyebrow="Fresh on Swapify"
        title="Featured listings"
        description="New items listed by the community, ready to be swapped."
        actionHref="/browse"
        actionLabel="Browse all"
      />
      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
