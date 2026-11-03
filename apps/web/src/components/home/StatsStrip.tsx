"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";
import { BadgePoundSterling, Handshake, ShieldCheck, MapPinned } from "lucide-react";

const STATS = [
  { icon: BadgePoundSterling, value: 0, prefix: "£", suffix: "", label: "to list an item" },
  { icon: Handshake, value: 2, prefix: "", suffix: "×", label: "confirmations before payout" },
  { icon: ShieldCheck, value: 100, prefix: "", suffix: "%", label: "of payments held in escrow" },
  { icon: MapPinned, value: 5, prefix: "", suffix: " mi", label: "hyper-local matching radius" },
];

function Counter({ target, prefix, suffix }: { target: number; prefix: string; suffix: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const [n, setN] = useState(reduce ? target : 0);

  useEffect(() => {
    if (!inView || reduce) return;
    let raf = 0;
    const start = performance.now();
    const dur = 900;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduce, target]);

  return (
    <span ref={ref} className="text-3xl font-bold tracking-tight text-navy">
      {prefix}
      {n}
      {suffix}
    </span>
  );
}

export default function StatsStrip() {
  return (
    <section className="border-y border-line bg-surface">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-4 py-10 sm:px-6 lg:grid-cols-4 lg:px-8">
        {STATS.map(({ icon: Icon, value, prefix, suffix, label }) => (
          <div key={label} className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-primary/10 text-primary-soft">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <Counter target={value} prefix={prefix} suffix={suffix} />
              <p className="mt-0.5 text-xs text-muted">{label}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
