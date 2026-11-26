import { BadgeCheck, CreditCard, Lock, PackagePlus, Repeat, Search } from "lucide-react";
import { FadeUp } from "../motion";

const STEPS = [
  {
    icon: PackagePlus,
    step: "01",
    title: "List what you have",
    body: "Snap a photo, add a note, set a fair cash value.",
  },
  {
    icon: Search,
    step: "02",
    title: "Find a match",
    body: "Browse what people nearby are ready to part with.",
  },
  {
    icon: Repeat,
    step: "03",
    title: "Agree on a swap",
    body: "Chat, propose a trade, and both sides accept.",
  },
  {
    icon: CreditCard,
    step: "04",
    title: "Settle the difference",
    body: "Any value gap becomes a cash top-up, held until you both confirm.",
  },
];

/**
 * Merged "how it works + protection" band (replaces the old separate
 * HowItWorks + Protected sections): the swap loop and the money safeguards
 * told as one story.
 */
export default function HowItWorksProtectedBand() {
  return (
    <section id="how-it-works" className="bg-dots border-y border-line">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8">
        <FadeUp className="order-2 lg:order-1">
          <div className="relative">
            <div className="overflow-hidden rounded-[28px] border border-line shadow-raise">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/swap6.jpg"
                alt="Two people inspecting a jacket together at a clothing swap"
                width={736}
                height={730}
                loading="lazy"
                className="aspect-square w-full object-cover"
              />
            </div>
            <div className="glass absolute -left-2 top-6 rounded-card px-4 py-3 shadow-card sm:-left-6">
              <p className="text-[10px] font-semibold text-muted">Value gap</p>
              <p className="mt-0.5 text-sm font-bold text-token">+ £150.00 held in escrow</p>
            </div>
            <div className="glass absolute -bottom-4 right-2 flex items-center gap-2 rounded-pill px-4 py-2.5 shadow-card sm:right-6">
              <BadgeCheck className="h-4 w-4 text-success" aria-hidden />
              <span className="text-xs font-semibold text-navy">Swap matched!</span>
            </div>
          </div>
        </FadeUp>

        <FadeUp delay={0.1} className="order-1 lg:order-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-soft">
            How it works
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-navy sm:text-4xl">
            How swapping stays fair
          </h2>
          <p className="mt-4 max-w-lg text-muted">
            Four simple steps, and your money only moves when the swap really happens.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {STEPS.map(({ icon: Icon, step, title, body }) => (
              <div key={step} className="rounded-card border border-line bg-surface p-4 shadow-card">
                <div className="flex items-center justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-pill bg-primary/10 text-primary-soft">
                    <Icon className="h-4.5 w-4.5" aria-hidden />
                  </span>
                  <span className="text-xs font-bold text-line-strong">{step}</span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-navy">{title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted">{body}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-start gap-3 rounded-card border border-token/30 bg-token/10 p-4">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-token" aria-hidden />
            <p className="text-sm text-foreground/90">
              No awkward haggling. When values do not match, the difference becomes a cash top-up
              held in escrow until both sides confirm.
            </p>
          </div>
        </FadeUp>
      </div>
    </section>
  );
}
