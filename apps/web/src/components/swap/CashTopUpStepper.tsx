"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeftRight, Coins, Sparkles } from "lucide-react";
import { formatPence } from "@/lib/api";

/**
 * Cash top-up read-out: shows the exact value-gap settlement for the selected
 * pair with clear breakdown badges. The amount is derived from fair item values
 * (server-side settlement), so the +/- controls reflect which side pays rather
 * than an arbitrary amount.
 */
export default function CashTopUpStepper({
  myValuePence,
  targetValuePence,
  myTitle,
  targetTitle,
}: {
  myValuePence: number;
  targetValuePence: number;
  myTitle: string;
  targetTitle: string;
}) {
  const reduce = useReducedMotion();
  const gap = Math.abs(myValuePence - targetValuePence);
  const iPay = myValuePence < targetValuePence;
  const balanced = gap === 0;

  return (
    <div className="rounded-card border border-line bg-surface-2 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted">
        <Coins className="h-4 w-4 text-token-soft" aria-hidden />
        Cash top-up
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted">{myTitle}</p>
          <p className="text-sm font-bold text-navy">{formatPence(myValuePence)}</p>
        </div>
        <ArrowLeftRight className="h-4 w-4 shrink-0 text-primary-soft" aria-hidden />
        <div className="min-w-0 text-right">
          <p className="truncate text-xs text-muted">{targetTitle}</p>
          <p className="text-sm font-bold text-navy">{formatPence(targetValuePence)}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center">
        <div className="flex items-center gap-3 rounded-btn border border-token/40 bg-token/10 px-4 py-2.5">
          <button
            type="button"
            disabled
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-full border border-token/40 text-token/60"
          >
            −
          </button>
          <motion.span
            key={gap}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="min-w-[5.5rem] text-center text-lg font-bold text-token"
          >
            {balanced ? "£0.00" : `+${formatPence(gap)}`}
          </motion.span>
          <button
            type="button"
            disabled
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-full border border-token/40 text-token/60"
          >
            +
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px]">
        <span className="rounded-pill border border-line bg-surface px-2.5 py-1 font-semibold text-muted">
          {myTitle.length > 16 ? `${myTitle.slice(0, 16)}…` : myTitle} = {formatPence(myValuePence)}
        </span>
        {!balanced && (
          <span className="rounded-pill border border-token/40 bg-token/10 px-2.5 py-1 font-semibold text-token">
            + {formatPence(gap)} cash top-up
          </span>
        )}
        <span className="rounded-pill border border-emerald-500/40 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          {balanced ? (
            <>
              <Sparkles className="mr-1 inline h-3 w-3" aria-hidden />
              Values match — no payment
            </>
          ) : (
            `= Balanced trade (${formatPence(Math.max(myValuePence, targetValuePence))})`
          )}
        </span>
      </div>

      <p className="mt-3 text-center text-[11px] text-muted">
        {balanced
          ? "Even trade — items swap hands directly."
          : iPay
            ? `You'll pay ${formatPence(gap)} into escrow to balance the trade.`
            : `The owner pays ${formatPence(gap)} into escrow to even it out.`}
      </p>
    </div>
  );
}
