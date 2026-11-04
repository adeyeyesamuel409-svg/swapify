import type { ApiItem } from "@/lib/api";
import ItemCard from "../ItemCard";
import SectionHeader from "../SectionHeader";
import Button from "../Button";
import { Stagger, StaggerItem } from "../motion";
import { MapPin, Store } from "lucide-react";

export default function DiscoveryFeedSection({ items }: { items: ApiItem[] }) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <SectionHeader
        eyebrow="Near you"
        title="Local discovery feed"
        description="Fresh listings from swappers in your area — trust signals and fair-value hints built in."
        actionHref="/browse"
        actionLabel="Browse all"
      />

      {items.length > 0 ? (
        <Stagger className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.slice(0, 9).map((item) => (
            <StaggerItem key={item.id}>
              <ItemCard item={item} />
            </StaggerItem>
          ))}
        </Stagger>
      ) : (
        <div className="mt-8 rounded-card border border-dashed border-line bg-surface px-6 py-14 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-pill bg-primary/10 text-primary-soft">
            <Store className="h-7 w-7" aria-hidden />
          </span>
          <h3 className="mt-4 text-xl font-bold text-navy">No listings near you yet</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Be the first in your area — post an item you no longer use and watch the swap offers
            arrive. It takes about a minute.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button href="/browse" size="md">
              <MapPin className="h-4 w-4" aria-hidden />
              Explore Swaps Near You
            </Button>
            <Button href="/post" size="md" variant="secondary">
              Post an item
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
