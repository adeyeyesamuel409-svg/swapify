"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeftRight, Coins, MapPin, ShieldCheck, Star } from "lucide-react";
import TradeFairnessMeter from "@/components/swap/TradeFairnessMeter";

const YOUR_VALUE = 4000; // £40.00
const THEIR_VALUE = 6500; // £65.00
const GAP = THEIR_VALUE - YOUR_VALUE;

const fmt = (pence: number) => `£${(pence / 100).toFixed(2)}`;

export default function SwapSimulator() {
  const reduce = useReducedMotion();
  const [topUp, setTopUp] = useState(Math.round(GAP / 2 / 100) * 100);
  const balanced = topUp === GAP;
  const effective = YOUR_VALUE + topUp;

  return (
    <div className="rounded-card border border-line bg-surface p-5 shadow-raise sm:p-6">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-soft">Swap simulator</p>
        <span className="inline-flex items-center gap-1 rounded-pill border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary-soft">
          <ShieldCheck className="h-3 w-3" aria-hidden />
          Escrow protected
        </span>
      </div>

      {/* split trade board */}
      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-stretch gap-3">
        <motion.div
          className="overflow-hidden rounded-card border border-line bg-surface-2"
          initial={reduce ? false : { opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="relative aspect-[4/3]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/swapify1.jpeg" alt="Your item" className="h-full w-full object-cover" />
            <span className="absolute left-2 top-2 rounded-pill border border-line bg-bg/85 px-2 py-0.5 text-[10px] font-semibold text-foreground backdrop-blur">
              Your item
            </span>
          </div>
          <div className="p-2.5">
            <p className="truncate text-xs font-semibold text-navy">Vintage film camera</p>
            <p className="text-[11px] font-bold text-token">{fmt(YOUR_VALUE)}</p>
            <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted">
              <MapPin className="h-2.5 w-2.5 text-primary-soft" aria-hidden /> 0.8 mi away
            </p>
          </div>
        </motion.div>

        <div className="flex flex-col items-center justify-center gap-2">
          <motion.span
            className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary-soft"
            animate={reduce ? undefined : { rotate: [0, -8, 8, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          >
            <ArrowLeftRight className="h-4.5 w-4.5" aria-hidden />
          </motion.span>
          <motion.span
            key={topUp}
            initial={reduce ? false : { opacity: 0, y: 6, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.22 }}
            className={`inline-flex items-center gap-1 rounded-pill border px-2.5 py-1 text-[11px] font-bold backdrop-blur ${
              balanced
                ? "border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                : "border-token/40 bg-token/10 text-token"
            }`}
          >
            <Coins className="h-3 w-3" aria-hidden />
            {balanced ? "Balanced!" : `${fmt(topUp)} top-up`}
          </motion.span>
        </div>

        <motion.div
          className="overflow-hidden rounded-card border border-line bg-surface-2"
          initial={reduce ? false : { opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
        >
          <div className="relative aspect-[4/3]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/swapify2.jpeg" alt="Their item" className="h-full w-full object-cover" />
            <span className="absolute left-2 top-2 rounded-pill border border-line bg-bg/85 px-2 py-0.5 text-[10px] font-semibold text-foreground backdrop-blur">
              Their item
            </span>
          </div>
          <div className="p-2.5">
            <p className="truncate text-xs font-semibold text-navy">Road bike, barely used</p>
            <p className="text-[11px] font-bold text-token">{fmt(THEIR_VALUE)}</p>
            <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted">
              <Star className="h-2.5 w-2.5 fill-token-soft text-token-soft" aria-hidden /> 4.9 trusted swapper
            </p>
          </div>
        </motion.div>
      </div>

      {/* cash slider */}
      <div className="mt-5">
        <div className="flex items-center justify-between text-xs">
          <label htmlFor="sim-topup" className="font-semibold text-muted">
            Adjust cash top-up
          </label>
          <span className="font-semibold text-navy">
            {fmt(topUp)} <span className="text-muted">/ {fmt(GAP)} to balance</span>
          </span>
        </div>
        <input
          id="sim-topup"
          type="range"
          min={0}
          max={GAP}
          step={100}
          value={topUp}
          onChange={(e) => setTopUp(Number(e.target.value))}
          className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-pill bg-surface-3 accent-primary"
          aria-valuetext={`${fmt(topUp)} cash top-up`}
        />
      </div>

      {/* live balance engine */}
      <div className="mt-4">
        <TradeFairnessMeter myValuePence={effective} targetValuePence={THEIR_VALUE} />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px]">
        <span className="rounded-pill border border-line bg-surface-2 px-2.5 py-1 font-semibold text-muted">
          Your item {fmt(YOUR_VALUE)}
        </span>
        {!balanced && (
          <span className="rounded-pill border border-token/40 bg-token/10 px-2.5 py-1 font-semibold text-token">
            + {fmt(topUp)} cash
          </span>
        )}
        <span className={`rounded-pill border px-2.5 py-1 font-semibold ${
          balanced
            ? "border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
            : "border-line bg-surface-2 text-muted"
        }`}>
          = {fmt(effective)} vs {fmt(THEIR_VALUE)}
        </span>
      </div>
    </div>
  );
}
