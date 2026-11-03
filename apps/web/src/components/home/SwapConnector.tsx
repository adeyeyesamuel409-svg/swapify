"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * Animated ⇄ connector between "how it works" steps — the swap glyph
 * breathes on a slow loop (pure CSS/framer, reduced-motion safe).
 */
export default function SwapConnector() {
  const reduce = useReducedMotion();
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-full border border-primary/30 bg-surface text-primary-soft shadow-card">
      <motion.svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        animate={reduce ? undefined : { x: [-2, 2, -2] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
      >
        <path d="M8 3 L4 7 L8 11" />
        <path d="M4 7 H16" />
        <path d="M16 21 L20 17 L16 13" />
        <path d="M20 17 H8" />
      </motion.svg>
    </span>
  );
}
