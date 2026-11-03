import { MapPin, PackagePlus, ShieldCheck, Sparkles, Star } from "lucide-react";
import Button from "../Button";
import SwapSimulator from "./SwapSimulator";

export default function HeroSection() {
  return (
    <section className="relative overflow-hidden">
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
        style={{ background: "linear-gradient(100deg,#881337,#a61b4d,#0f172a)" }}
        aria-hidden
      />

      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-2 lg:gap-10 lg:pt-24 lg:px-8">
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-1.5 rounded-pill border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary-soft">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Free to join &middot; Fair value gaps &middot; Protected swaps
          </span>

          <h1 className="mt-5 text-4xl font-bold leading-[1.05] tracking-tight text-navy sm:text-5xl lg:text-6xl">
            Trade What You Have.{" "}
            <span className="text-gradient">Get What You Love.</span>
          </h1>

          <p className="mt-5 max-w-lg text-lg text-muted">
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

          {/* nearby teaser */}
          <div className="glass mt-8 flex max-w-sm items-center gap-3 rounded-card p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/swapify3.jpeg"
              alt="Nearby listing"
              className="h-14 w-14 shrink-0 rounded-btn object-cover"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-navy">Nearby, ready to swap</p>
              <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted">
                <MapPin className="h-3 w-3 text-primary-soft" aria-hidden />
                240+ listings within 5 miles
              </p>
            </div>
            <span className="ml-auto shrink-0 rounded-pill border border-emerald-500/40 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              Live
            </span>
          </div>
        </div>

        <div className="relative">
          <SwapSimulator />
        </div>
      </div>
    </section>
  );
}
