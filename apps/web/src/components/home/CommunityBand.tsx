import Link from "next/link";
import { ArrowRight, CalendarHeart, Leaf, Sparkles } from "lucide-react";
import { FadeUp } from "../motion";

const POINTS = [
  {
    icon: CalendarHeart,
    title: "Swap-meet energy",
    body: "Great finds and fair trades, no Saturday sacrificed.",
  },
  {
    icon: Leaf,
    title: "Curated, not cluttered",
    body: "Every listing shows condition, fair value and trust signals up front.",
  },
  {
    icon: Sparkles,
    title: "No haggling required",
    body: "Smart value balancing settles differences automatically, so trades stay friendly.",
  },
];

export default function CommunityBand() {
  return (
    <section className="bg-dots border-y border-line">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8">
        <FadeUp>
          <div className="relative">
            <div className="overflow-hidden rounded-[28px] border border-line bg-surface shadow-raise">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/swap5.jpg"
                alt="A community swap table laid out with shoes, bags and jeans under a Sip & Swap sign"
                width={1200}
                height={1600}
                className="aspect-[3/4] w-full object-cover object-[center_60%]"
                loading="lazy"
              />
            </div>
            <div className="glass absolute -bottom-5 right-3 flex items-center gap-2 rounded-pill px-4 py-2.5 shadow-card sm:right-6">
              <CalendarHeart className="h-4 w-4 text-primary-soft" aria-hidden />
              <span className="text-xs font-semibold text-navy">Sip &amp; Swap, every weekend</span>
            </div>
          </div>
        </FadeUp>

        <FadeUp delay={0.1}>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-soft">
            Community
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-navy sm:text-4xl">
            The swap-meet feeling, minus the folding tables
          </h2>
          <p className="mt-4 max-w-lg text-muted">
            Great finds, fair trades, zero folding tables. All the best parts of a swap meet, on
            your schedule.
          </p>

          <div className="mt-8 space-y-5">
            {POINTS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex items-start gap-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-primary/10 text-primary-soft">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <h3 className="font-semibold text-navy">{title}</h3>
                  <p className="mt-1 text-sm text-muted">{body}</p>
                </div>
              </div>
            ))}
          </div>

          <Link
            href="/browse"
            className="group mt-8 inline-flex items-center gap-2 rounded-btn bg-brand px-5 py-2.5 font-semibold text-white shadow-glow transition-all hover:scale-[1.02] hover:brightness-110 active:scale-[0.98]"
          >
            Browse listings
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </FadeUp>
      </div>
    </section>
  );
}
