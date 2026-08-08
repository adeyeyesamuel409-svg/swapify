import { Coins, PackagePlus, Repeat, Search } from "lucide-react";
import SectionHeader from "../SectionHeader";

const STEPS = [
  {
    icon: PackagePlus,
    step: "01",
    title: "List what you have",
    body: "Snap a photo, add a short description, and we estimate a fair token value for your item.",
  },
  {
    icon: Search,
    step: "02",
    title: "Find a match",
    body: "Browse listings or save a wishlist — we surface items people nearby are ready to part with.",
  },
  {
    icon: Repeat,
    step: "03",
    title: "Agree on a swap",
    body: "Propose a trade. When both sides accept, your tokens are locked in escrow so no one gets left out.",
  },
  {
    icon: Coins,
    step: "04",
    title: "Tokens balance the gap",
    body: "Values rarely match exactly. Tokens cover the difference, so every swap stays fair and simple.",
  },
];

export default function HowItWorksSection() {
  return (
    <section id="how-it-works" className="border-y border-line bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="How it works"
          title="A marketplace built around trading, not cash"
          description="Four simple steps from clutter to treasure. No checkout needed — just fair, protected swaps."
        />
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ icon: Icon, step, title, body }) => (
            <div
              key={step}
              className="group rounded-card border border-line bg-surface-2 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-raise"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-btn bg-primary/15 text-primary-soft transition-colors group-hover:bg-brand group-hover:text-white">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="text-sm font-bold text-line-strong">{step}</span>
              </div>
              <h3 className="mt-4 font-semibold text-foreground">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
