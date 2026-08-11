import { ArrowRight, PackagePlus, ShieldCheck, Sparkles } from "lucide-react";
import Button from "../Button";
import type { ApiItem } from "@/lib/api";
import { formatPence, resolveImageUrl } from "@/lib/api";

function HeroPhoto({ item, className = "" }: { item: ApiItem; className?: string }) {
  const img = item.images[0]?.url;
  return (
    <div className={`relative overflow-hidden rounded-card border border-line bg-surface-2 ${className}`}>
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={resolveImageUrl(img)} alt={item.title} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-muted">No photo</div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-bg/90 to-transparent px-3 pb-2 pt-6">
        <p className="line-clamp-1 text-sm font-semibold text-foreground">{item.title}</p>
        <p className="text-xs text-token">{formatPence(item.valuePence)}</p>
      </div>
    </div>
  );
}

export default function HeroSection({ items }: { items: ApiItem[] }) {
  const photos = items.filter((i) => i.images.length > 0).slice(0, 4);
  const big = photos[0];
  const rest = photos.slice(1, 4);

  return (
    <section className="relative overflow-hidden">
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full opacity-30 blur-3xl"
        style={{ background: "linear-gradient(100deg,#6366f1,#8b5cf6,#d946ef)" }}
        aria-hidden
      />

      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-2 lg:gap-8 lg:pt-24 lg:px-8">
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-1.5 rounded-pill border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary-soft">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Free to join · Fair value gaps · Protected swaps
          </span>

          <h1 className="mt-5 text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Swap what you no longer use for{" "}
            <span className="text-gradient">what you need.</span>
          </h1>

          <p className="mt-5 max-w-lg text-lg text-muted">
            List the things gathering dust and discover things you actually want — from people nearby.
            When values don&apos;t match, a small payment balances the difference.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button href="/browse" size="lg">
              Explore listings
              <ArrowRight className="h-4.5 w-4.5" aria-hidden />
            </Button>
            <Button href="/post" size="lg" variant="secondary">
              <PackagePlus className="h-4.5 w-4.5" aria-hidden />
              Post an item
            </Button>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden />
              Payments held until both sides confirm
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary-soft" aria-hidden />
              Values estimated for fair trades
            </span>
          </div>
        </div>

        <div className="relative hidden lg:block">
          {big ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <HeroPhoto item={big} className="col-span-2 h-64" />
                {rest.map((item) => (
                  <HeroPhoto key={item.id} item={item} className="h-40" />
                ))}
              </div>
              <div className="absolute -right-4 -top-4 rounded-card border border-token/30 bg-bg/90 px-4 py-3 shadow-raise backdrop-blur">
                <p className="text-xs text-muted">Latest listing</p>
                <p className="text-lg font-bold text-token">{formatPence(big.valuePence)}</p>
              </div>
            </>
          ) : (
            <div className="flex h-[400px] items-center justify-center rounded-card border border-dashed border-line bg-surface/50 text-muted">
              Fresh listings appear here
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
