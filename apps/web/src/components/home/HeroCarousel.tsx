"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

type Slide = { src: string; alt: string; position: string };

const SLIDES: Slide[] = [
  {
    src: "/swap3.jpg",
    alt: "A swapper wheeling a rail of pre-loved clothes along a brick wall",
    position: "center 35%",
  },
  {
    src: "/swap8.jpg",
    alt: "Choosing a shoe from a clothing rail at a neighbourhood swap",
    position: "center 30%",
  },
  {
    src: "/swap9.jpg",
    alt: "Wheeling a rail of clothes through the neighbourhood",
    position: "center 35%",
  },
  {
    src: "/swap10.jpg",
    alt: "Laughing with a pair of heels at a clothing swap",
    position: "center 25%",
  },
  {
    src: "/swap11.jpg",
    alt: "Hanging shoes on a rail of pre-loved clothes",
    position: "center 35%",
  },
];

const INTERVAL_MS = 3000;

/**
 * Hero photo carousel: auto-rotates every 5s with a soft crossfade + zoom,
 * pauses on hover/focus, dots jump to a slide, reduced-motion stays static.
 */
export default function HeroCarousel() {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), INTERVAL_MS);
    return () => clearInterval(id);
  }, [reduce]);

  const slide = SLIDES[index];

  return (
    <div className="overflow-hidden rounded-[28px] border border-line shadow-raise">
      <div className="relative aspect-[3/4] w-full bg-surface-2">
        <AnimatePresence initial={false}>
          <motion.img
            key={slide.src}
            src={slide.src}
            alt={slide.alt}
            width={732}
            height={1100}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ objectPosition: slide.position }}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? undefined : { opacity: 0 }}
            transition={{ duration: 1, ease: "easeInOut" }}
          />
        </AnimatePresence>
      </div>
    </div>
  );
}
