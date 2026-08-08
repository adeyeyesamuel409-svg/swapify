import { ArrowRight, PackagePlus } from "lucide-react";
import Button from "../Button";

export default function FinalCtaSection() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="relative overflow-hidden rounded-card bg-brand px-6 py-16 text-center shadow-raise sm:px-12">
        <div
          className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[600px] -translate-x-1/2 rounded-full bg-white/15 blur-3xl"
          aria-hidden
        />
        <div className="relative">
          <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Ready to turn your clutter into something you actually want?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-white/80">
            Join Swapify and start trading with people nearby — no cash, no friction, just fair swaps
            protected by tokens.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button
              href="/browse"
              size="lg"
              className="bg-white text-primary-strong hover:bg-white/90"
            >
              Explore listings
              <ArrowRight className="h-4.5 w-4.5" aria-hidden />
            </Button>
            <Button
              href="/post"
              size="lg"
              variant="secondary"
              className="border-white/40 bg-white/10 text-white hover:bg-white/20"
            >
              <PackagePlus className="h-4.5 w-4.5" aria-hidden />
              Post an item
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
