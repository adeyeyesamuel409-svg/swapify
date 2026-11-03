import Link from "next/link";
import {
  Armchair,
  BookOpen,
  CookingPot,
  Cpu,
  Dumbbell,
  Gamepad2,
  Package,
  Shirt,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { CATEGORIES, CATEGORY_LABELS } from "@swapify/shared";

const CATEGORY_ICONS: Record<(typeof CATEGORIES)[number], LucideIcon> = {
  ELECTRONICS: Cpu,
  FURNITURE: Armchair,
  CLOTHING: Shirt,
  BOOKS: BookOpen,
  GAMES: Gamepad2,
  TOOLS: Wrench,
  SPORTS: Dumbbell,
  HOME_KITCHEN: CookingPot,
  COLLECTIBLES: Sparkles,
  OTHER: Package,
};

export default function CategoryStrip() {
  return (
    <section id="categories" className="mx-auto max-w-7xl px-4 pt-12 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary-soft">
          Browse by category
        </span>
        {CATEGORIES.map((category) => {
          const Icon = CATEGORY_ICONS[category];
          return (
            <Link
              key={category}
              href={`/browse?category=${category}`}
              className="group inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-muted transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:text-primary-soft"
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {CATEGORY_LABELS[category]}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
