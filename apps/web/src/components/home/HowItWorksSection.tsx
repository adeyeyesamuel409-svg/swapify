import { CreditCard, PackagePlus, Repeat, Search } from "lucide-react";
import SectionHeader from "../SectionHeader";

const STEPS = [
  {
    icon: PackagePlus,
    step: "01",
    title: "List what you have",
    body: "Snap a photo, add a short description, and set a fair cash value for your item.",
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
    body: "Propose a trade. When both sides accept, the value-gap payment is held securely until both confirm receipt.",
  },
  {
    icon: CreditCard,
    step: "04",
    title: "Pay the difference",
    body: "Values rarely match exactly. The gap is settled with a secure card payment, so every swap stays fair and simple.",
  },
];

export default function HowItWorksSection() {
  return (
    <section id="how-it-works" className="border-y border-line bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="How it works"
          title="A marketplace built around trading"
          description="Four simple steps from clutter to treasure. No haggling — just fair, protected swaps."
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
