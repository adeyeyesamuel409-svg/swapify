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
import SectionHeader from "../SectionHeader";

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

export default function CategoriesSection() {
  return (
    <section id="categories" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <SectionHeader
        eyebrow="Browse by category"
        title="Find exactly what you're looking for"
        description="From electronics to collectibles — there's a swap for every corner of your home."
      />
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {CATEGORIES.map((category) => {
          const Icon = CATEGORY_ICONS[category];
          return (
            <Link
              key={category}
              href={`/browse?category=${category}`}
              className="group flex flex-col items-center gap-3 rounded-card border border-line bg-surface p-5 text-center transition-all duration-300 hover:-translate-y-1 hover:border-primary/50 hover:shadow-card"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-pill bg-surface-3 text-muted transition-colors group-hover:bg-primary/15 group-hover:text-primary-soft">
                <Icon className="h-6 w-6" aria-hidden />
              </span>
              <span className="text-sm font-semibold text-foreground group-hover:text-primary-soft">
                {CATEGORY_LABELS[category]}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
