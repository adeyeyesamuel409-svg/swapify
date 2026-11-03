import { MapPin, PackagePlus, ShieldCheck, Sparkles, Star } from "lucide-react";
import Button from "../Button";
import SwapMatchMotion from "./SwapMatchMotion";

function SwapMotif() {
  return (
    <svg
      className="pointer-events-none absolute -right-24 -top-24 h-[520px] w-[520px] opacity-[0.16]"
      viewBox="0 0 520 520"
      fill="none"
      aria-hidden
    >
      <path
        d="M60 380 C 180 120, 340 120, 460 380"
        stroke="#881337"
        strokeWidth="2"
        strokeDasharray="10 12"
      />
      <path
        d="M60 140 C 180 400, 340 400, 460 140"
        stroke="#0f172a"
        strokeWidth="2"
        strokeDasharray="10 12"
      />
      <path d="M448 366 L462 384 L440 388" stroke="#881337" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M448 154 L462 136 L440 132" stroke="#0f172a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function HeroSection() {
  return (
    <section className="bg-dots relative overflow-hidden">
      <SwapMotif />

      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-2 lg:gap-14 lg:pt-24 lg:px-8">
        {/* ---------------- copy ---------------- */}
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-1.5 rounded-pill border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary-soft">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Hyper-local &middot; Fair value balancing &middot; Protected swaps
          </span>

          <h1 className="mt-5 text-4xl font-bold leading-[1.06] tracking-tight text-navy sm:text-5xl lg:text-[3.4rem]">
            Trade What You Have.{" "}
            <span className="text-accent">Get What You Love.</span>
          </h1>

          <p className="mt-5 max-w-lg text-lg leading-relaxed text-muted">
            Turn dust-gatherers into instant upgrades with hyper-local direct swapping and smart
            value balancing.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button href="/browse" size="lg">
              <MapPin className="h-4.5 w-4.5" aria-hidden />
              Start Swapping Near You
            </Button>
            <Button href="/post" size="lg" variant="secondary">
              <PackagePlus className="h-4.5 w-4.5" aria-hidden />
              Post an item
            </Button>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
              Payments held until both sides confirm
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Star className="h-4 w-4 fill-token-soft text-token-soft" aria-hidden />
              Trusted local swappers
            </span>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted">Popular:</span>
            {["Electronics", "Furniture", "Bikes", "Collectibles"].map((c) => (
              <a
                key={c}
                href={`/browse?q=${encodeURIComponent(c)}`}
                className="rounded-pill border border-line bg-surface px-3 py-1 font-semibold text-muted transition-colors hover:border-primary/50 hover:text-primary-soft"
              >
                {c}
              </a>
            ))}
          </div>
        </div>

        {/* ---------------- high-res showcase ---------------- */}
        <div className="relative">
          <div className="overflow-hidden rounded-[28px] border border-line shadow-raise">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/swapify1.jpeg"
              alt="A swapper using the Swapify app to arrange a local exchange"
              width={1024}
              height={768}
              className="aspect-[4/3] w-full object-cover"
            />
          </div>

          {/* floating chips */}
          <div className="absolute -left-2 top-6 sm:-left-6">
            <div className="glass flex items-center gap-2 rounded-pill px-3.5 py-2 shadow-card">
              <MapPin className="h-3.5 w-3.5 text-primary-soft" aria-hidden />
              <span className="text-xs font-semibold text-navy">0.8 mi away</span>
            </div>
          </div>

          <div className="absolute -right-2 top-24 sm:-right-5">
            <div className="glass flex items-center gap-2 rounded-pill px-3.5 py-2 shadow-card">
              <Star className="h-3.5 w-3.5 fill-token-soft text-token-soft" aria-hidden />
              <span className="text-xs font-semibold text-navy">4.9</span>
              <span className="text-[11px] text-muted">(32 swaps)</span>
            </div>
          </div>

          {/* signature swap motion */}
          <div className="absolute -bottom-8 left-2 sm:-bottom-6 sm:left-6">
            <SwapMatchMotion />
          </div>

          <div className="absolute -bottom-4 right-2 hidden sm:right-6 sm:block">
            <div className="glass flex items-center gap-2 rounded-pill px-3.5 py-2 shadow-card">
              <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden />
              <span className="text-xs font-semibold text-navy">Escrow protected</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
