import Link from "next/link";
import { Repeat } from "lucide-react";

const COLUMNS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: "Marketplace",
    links: [
      { label: "Browse listings", href: "/browse" },
      { label: "Post an item", href: "/post" },
      { label: "How it works", href: "/#how-it-works" },
      { label: "Categories", href: "/#categories" },
    ],
  },
  {
    heading: "Account",
    links: [
      { label: "My wallet", href: "/wallet" },
      { label: "My swaps", href: "/swaps" },
      { label: "Wishlists", href: "/wishlists" },
      { label: "Profile", href: "/profile" },
    ],
  },
  {
    heading: "Tokens",
    links: [
      { label: "What are tokens?", href: "/#tokens" },
      { label: "Buy tokens", href: "/tokens" },
      { label: "Notifications", href: "/notifications" },
    ],
  },
];

export default function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[1.5fr_repeat(3,1fr)]">
          <div>
            <Link href="/" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-btn bg-brand text-white">
                <Repeat className="h-4.5 w-4.5" aria-hidden />
              </span>
              <span className="text-lg font-bold tracking-tight text-foreground">Swapify</span>
            </Link>
            <p className="mt-3 max-w-xs text-sm text-muted">
              Swap what you no longer use for what you need. When values don&apos;t match, our tokens
              balance the difference.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <h3 className="text-sm font-semibold text-foreground">{col.heading}</h3>
              <ul className="mt-3 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="text-sm text-muted transition-colors hover:text-foreground">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-line pt-6 sm:flex-row sm:items-center">
          <p className="text-xs text-muted">© {new Date().getFullYear()} Swapify. Trade what you own, keep what you love.</p>
          <p className="text-xs text-muted">Listings and swaps are powered by a token escrow you can trust.</p>
        </div>
      </div>
    </footer>
  );
}
