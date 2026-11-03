import type { ApiItem } from "@/lib/api";
import ItemCard from "../ItemCard";
import SectionHeader from "../SectionHeader";
import { Stagger, StaggerItem } from "../motion";
import { mockProximity, mockTradePreference, mockTrust } from "@/lib/mock";
import Link from "next/link";
import { MapPin, Repeat, Star } from "lucide-react";

const DEMO_CARDS = [
  { img: "/swapify1.jpeg", title: "Vintage film camera", value: "£40.00", id: "demo-1" },
  { img: "/swapify2.jpeg", title: "Road bike, barely used", value: "£65.00", id: "demo-2" },
  { img: "/swapify3.jpeg", title: "Mid-century armchair", value: "£120.00", id: "demo-3" },
];

function DemoCard({ img, title, value, id }: { img: string; title: string; value: string; id: string }) {
  const distance = mockProximity(id);
  const trust = mockTrust(id);
  const pref = mockTradePreference(id);
  return (
    <Link
      href="/browse"
      className="group mb-5 block overflow-hidden rounded-card border border-line bg-surface shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-raise"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-surface-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img}
          alt={title}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <span
          className={`absolute left-3 top-3 inline-flex items-center gap-1 rounded-pill border px-2.5 py-0.5 text-[11px] font-semibold backdrop-blur ${
            pref === "cash"
              ? "border-token/40 bg-bg/85 text-token"
              : "border-primary/30 bg-bg/85 text-primary-soft"
          }`}
        >
          <Repeat className="h-3 w-3" aria-hidden />
          {pref === "cash" ? "Open to Cash + Trade" : "Open to Trades"}
        </span>
        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-pill border border-line bg-bg/85 px-2.5 py-0.5 text-[11px] font-semibold text-foreground backdrop-blur">
          <MapPin className="h-3 w-3 text-primary-soft" aria-hidden />
          {distance}
        </span>
        <span className="absolute bottom-3 left-3 rounded-pill border border-token/40 bg-bg/85 px-2.5 py-1 text-xs font-bold text-token backdrop-blur">
          {value}
        </span>
      </div>
      <div className="p-4">
        <h3 className="line-clamp-1 font-semibold text-navy">{title}</h3>
        <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted">
          <Star className="h-3.5 w-3.5 fill-token-soft text-token-soft" aria-hidden />
          <span className="font-semibold text-foreground">{trust.rating}</span>
          <span className="text-muted/70">({trust.swaps} swaps)</span>
        </p>
      </div>
    </Link>
  );
}

export default function DiscoveryFeedSection({ items }: { items: ApiItem[] }) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <SectionHeader
        eyebrow="Near you"
        title="Local discovery feed"
        description="Fresh listings from swappers in your area — with trust scores and fair-value signals built in."
        actionHref="/browse"
        actionLabel="Browse all"
      />

      {items.length > 0 ? (
        <Stagger className="mt-8 columns-1 gap-5 sm:columns-2 lg:columns-3 [&>*]:mb-5">
          {items.slice(0, 9).map((item) => (
            <StaggerItem key={item.id} className="break-inside-avoid">
              <ItemCard item={item} />
            </StaggerItem>
          ))}
        </Stagger>
      ) : (
        <div className="mt-8 columns-1 gap-5 sm:columns-2 lg:columns-3">
          {DEMO_CARDS.map((c) => (
            <DemoCard key={c.id} {...c} />
          ))}
        </div>
      )}
    </section>
  );
}
