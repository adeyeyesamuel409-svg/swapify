"use client";

import { motion, useReducedMotion } from "framer-motion";

export type FairnessLevel = "balanced" | "close" | "unbalanced";

export function fairnessFor(aPence: number, bPence: number): {
  level: FairnessLevel;
  gapPence: number;
  ratio: number;
} {
  const gapPence = Math.abs(aPence - bPence);
  const max = Math.max(aPence, bPence, 1);
  const ratio = 1 - gapPence / max;
  const level: FairnessLevel = ratio >= 0.95 ? "balanced" : ratio >= 0.8 ? "close" : "unbalanced";
  return { level, gapPence, ratio };
}

const META: Record<FairnessLevel, { label: string; bar: string; text: string; track: string }> = {
  balanced: {
    label: "Balanced trade",
    bar: "bg-success",
    text: "text-success",
    track: "bg-success/15",
  },
  close: {
    label: "Close — small top-up",
    bar: "bg-warning",
    text: "text-warning",
    track: "bg-warning/15",
  },
  unbalanced: {
    label: "Unbalanced — cash top-up needed",
    bar: "bg-danger",
    text: "text-danger",
    track: "bg-danger/15",
  },
};

export default function TradeFairnessMeter({
  myValuePence,
  targetValuePence,
}: {
  myValuePence: number;
  targetValuePence: number;
}) {
  const reduce = useReducedMotion();
  const { level, ratio } = fairnessFor(myValuePence, targetValuePence);
  const meta = META[level];
  const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);

  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-muted">Trade fairness</span>
        <span className={`font-semibold ${meta.text}`}>{meta.label}</span>
      </div>
      <div className={`mt-2 h-2.5 w-full overflow-hidden rounded-pill ${meta.track}`}>
        <motion.div
          className={`h-full rounded-pill ${meta.bar}`}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 160, damping: 24 }}
        />
      </div>
    </div>
  );
}
