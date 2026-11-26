import Link from "next/link";
import {
  Armchair,
  Bike,
  BookOpen,
  CookingPot,
  Cpu,
  Shirt,
  type LucideIcon,
} from "lucide-react";

type Category = {
  label: string;
  href: string;
  icon: LucideIcon;
  photo: string;
};

const CATEGORIES: Category[] = [
  { label: "Electronics", href: "/browse?category=ELECTRONICS", icon: Cpu, photo: "/cat-electronics.jpg" },
  { label: "Fashion", href: "/browse?category=CLOTHING", icon: Shirt, photo: "/cat-fashion.jpg" },
  { label: "Furniture", href: "/browse?category=FURNITURE", icon: Armchair, photo: "/cat-furniture.jpg" },
  { label: "Sports & Bikes", href: "/browse?category=SPORTS", icon: Bike, photo: "/cat-sports.jpg" },
  { label: "Books", href: "/browse?category=BOOKS", icon: BookOpen, photo: "/cat-books.jpg" },
  { label: "Home & Kitchen", href: "/browse?category=HOME_KITCHEN", icon: CookingPot, photo: "/cat-home.jpg" },
];

/**
 * Visual category anchors: photo tiles with an icon-and-label fallback, so the
 * grid stays polished even before category photography lands.
 */
export default function CategoryAnchors() {
  return (
    <section id="categories" className="mx-auto max-w-7xl px-4 pt-12 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-soft">
            Browse by category
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-navy sm:text-3xl">
            See what&apos;s swapping near you
          </h2>
        </div>
        <Link href="/browse" className="text-sm font-semibold text-primary-soft hover:text-navy">
          View all listings
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {CATEGORIES.map(({ label, href, icon: Icon, photo }) => (
          <Link
            key={label}
            href={href}
            className="group relative block aspect-[4/5] overflow-hidden rounded-[20px] border border-line bg-surface-2"
          >
            <span
              aria-hidden
              className="absolute inset-0 bg-cover bg-center opacity-90 transition-transform duration-500 group-hover:scale-105"
              style={{ backgroundImage: `url(${photo})` }}
            />
            <span
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-navy/85 via-navy/25 to-transparent"
            />
            <span className="absolute inset-x-0 bottom-0 flex items-center gap-2 p-3">
              <Icon className="h-5 w-5 shrink-0 text-white" aria-hidden />
              <span className="text-sm font-semibold text-white">{label}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
