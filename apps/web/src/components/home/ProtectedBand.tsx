import { BadgeCheck, Coins, Lock, PackageCheck } from "lucide-react";
import { FadeUp } from "../motion";

const STEPS = [
  { icon: BadgeCheck, title: "Values balanced", body: "Both item values are compared live — any difference becomes a clear cash top-up." },
  { icon: Lock, title: "Payment held in escrow", body: "The top-up is secured by Swapify the moment the swap is agreed." },
  { icon: PackageCheck, title: "Both sides confirm", body: "Items change hands. Each side confirms the swap matched what was promised." },
  { icon: Coins, title: "Funds released", body: "Only then does the money move — refunds flow back automatically if a swap falls through." },
];

export default function ProtectedBand() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <FadeUp>
          <div className="relative">
            <div className="overflow-hidden rounded-[28px] border border-line shadow-raise">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/swap6.jpg"
                alt="Two people inspecting a jacket together at a clothing swap"
                width={736}
                height={730}
                className="aspect-square w-full object-cover"
                loading="lazy"
              />
            </div>

            {/* floating escrow cards */}
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

        <FadeUp delay={0.1}>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-soft">
            Protected swaps
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-navy sm:text-4xl">
            From handshake to handover, every swap is covered
          </h2>
          <p className="mt-4 max-w-lg text-muted">
            Asymmetric trades used to mean awkward haggling. Swapify turns the difference into a
            protected cash top-up that only moves when the swap really happens.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <div key={title} className="rounded-card border border-line bg-surface p-4 shadow-card">
                <div className="flex items-center justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-pill bg-primary/10 text-primary-soft">
                    <Icon className="h-4.5 w-4.5" aria-hidden />
                  </span>
                  <span className="text-xs font-bold text-line-strong">0{i + 1}</span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-navy">{title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted">{body}</p>
              </div>
            ))}
          </div>
        </FadeUp>
      </div>
    </section>
  );
}
