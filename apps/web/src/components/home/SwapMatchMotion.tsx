"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeftRight, Backpack, Camera, Check } from "lucide-react";

const SPRING = { type: "spring", stiffness: 210, damping: 22 } as const;

function MiniCard({
  icon: Icon,
  title,
  value,
  flipped = false,
}: {
  icon: typeof Camera;
  title: string;
  value: string;
  flipped?: boolean;
}) {
  return (
    <motion.div
      layout
      className="flex min-w-0 flex-1 items-center gap-2 rounded-btn border border-line bg-surface px-2.5 py-2 shadow-card"
      transition={SPRING}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-pill ${
          flipped ? "bg-token/15 text-token" : "bg-primary/10 text-primary-soft"
        }`}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold text-navy">{title}</p>
        <p className="text-[10px] font-bold text-token">{value}</p>
      </div>
    </motion.div>
  );
}

/**
 * Signature Swapify motion: two item cards trade places (spring physics),
 * the swap glyph rotates, and a "Swap matched!" check pops as they cross.
 * Purely presentational — echoes the exchange shown in the hero photograph.
 */
export default function SwapMatchMotion() {
  const reduce = useReducedMotion();
  const [swapped, setSwapped] = useState(false);

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setSwapped((v) => !v), 3400);
    return () => clearInterval(id);
  }, [reduce]);

  return (
    <div className="glass w-[15.5rem] rounded-card p-3 shadow-raise">
      <div className="flex items-center justify-between">
        <p className="inline-flex items-center gap-1 text-[10px] font-semibold text-success">
          <Check className="h-3 w-3" aria-hidden />
          Swap matched!
        </p>
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary-soft">
          <motion.span
            animate={reduce ? undefined : { rotate: swapped ? 180 : 0 }}
            transition={SPRING}
          >
            <ArrowLeftRight className="h-3 w-3" aria-hidden />
          </motion.span>
        </span>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        {swapped ? (
          <>
            <MiniCard icon={Backpack} title="Leather Backpack" value="£65.00" flipped />
            <MiniCard icon={Camera} title="DSLR Camera" value="£40.00" />
          </>
        ) : (
          <>
            <MiniCard icon={Camera} title="DSLR Camera" value="£40.00" />
            <MiniCard icon={Backpack} title="Leather Backpack" value="£65.00" flipped />
          </>
        )}
      </div>

      <div className="mt-2 flex items-center justify-center">
        <AnimatePresence mode="popLayout">
          <motion.span
            key={swapped ? "on" : "off"}
            initial={reduce ? false : { opacity: 0, y: 6, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: -6, scale: 0.9 }}
            transition={{ duration: 0.28 }}
            className="rounded-pill border border-token/40 bg-token/10 px-2.5 py-1 text-[10px] font-bold text-token"
          >
            + £25.00 cash top-up
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}
