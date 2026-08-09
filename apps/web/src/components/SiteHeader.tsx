"use client";

import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import {
  Coins,
  LogOut,
  Menu,
  Repeat,
  Search,
  Shield,
  User,
  Wallet,
  X,
} from "lucide-react";
import NotificationBell from "./NotificationBell";
import { fetchMe } from "@/lib/api";

const NAV_LINKS = [
  { href: "/browse", label: "Browse" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#categories", label: "Categories" },
  { href: "/tokens", label: "Tokens" },
];

function TokenBalance() {
  const { data: session } = useSession();
  const [tokens, setTokens] = useState<number | null>(null);

  useEffect(() => {
    if (!session?.accessToken) return;
    let cancelled = false;
    fetchMe(session.accessToken)
      .then(({ user }) => {
        if (!cancelled && user.wallet) {
          setTokens(Number(user.wallet.balanceMicroTokens) / 1_000_000);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session?.accessToken]);

  if (!session?.user || tokens === null) return null;

  return (
    <Link
      href="/wallet"
      className="inline-flex h-9 items-center gap-1.5 rounded-btn border border-token/25 bg-token/10 px-3 text-sm font-semibold text-token transition-colors hover:bg-token/20"
      title="Your token balance"
    >
      <Coins className="h-4 w-4" aria-hidden />
      {tokens}
    </Link>
  );
}

function UserMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const isAdmin = session?.user && (session.user as { admin?: { role: string } | null })?.admin;

  if (!session?.user) return null;

  const initial = (session.user.name ?? session.user.email ?? "U").slice(0, 1).toUpperCase();

  const links = [
    { href: "/profile", label: "Profile", icon: User },
    { href: "/wallet", label: "Wallet", icon: Wallet },
    { href: "/swaps", label: "My swaps", icon: Repeat },
    { href: "/wishlists", label: "Wishlists", icon: Coins },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-pill bg-brand text-sm font-bold text-white shadow-glow"
        aria-label="Account menu"
        aria-expanded={open}
      >
        {initial}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-card border border-line bg-surface shadow-raise">
            <div className="border-b border-line px-4 py-3">
              <p className="truncate text-sm font-semibold text-foreground">{session.user.name}</p>
              <p className="truncate text-xs text-muted">{session.user.email}</p>
            </div>
            <div className="p-1.5">
              {links.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground/90 transition-colors hover:bg-surface-2"
                >
                  <Icon className="h-4 w-4 text-muted" aria-hidden />
                  {label}
                </Link>
              ))}
              {isAdmin && (
                <Link
                  href="/admin"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground/90 transition-colors hover:bg-surface-2"
                >
                  <Shield className="h-4 w-4 text-muted" aria-hidden />
                  Admin dashboard
                </Link>
              )}
            </div>
            <div className="border-t border-line p-1.5">
              <button
                onClick={() => signOut()}
                className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-rose-300 transition-colors hover:bg-rose-950/50"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SearchForm({ className = "", onDone }: { className?: string; onDone?: () => void }) {
  const [q, setQ] = useState("");

  return (
    <form
      className={className}
      action="/browse"
      method="get"
      onSubmit={() => onDone?.()}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search items..."
          className="h-9 w-full rounded-btn border border-line bg-surface-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted focus:border-primary/60 focus:outline-none"
        />
      </div>
    </form>
  );
}

export default function SiteHeader() {
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-btn bg-brand text-white shadow-glow">
            <Repeat className="h-4.5 w-4.5" aria-hidden />
          </span>
          <span className="text-lg font-bold tracking-tight text-foreground">Swapify</span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          <SearchForm className="hidden w-56 xl:block" />
          <div className="hidden items-center gap-2.5 sm:flex">
            <NotificationBell />
            <TokenBalance />
            {session?.user ? (
              <UserMenu />
            ) : (
              <button
                onClick={() => signIn(undefined, { callbackUrl: window.location.pathname })}
                className="h-9 rounded-btn bg-brand px-4 text-sm font-semibold text-white shadow-glow transition-all hover:brightness-110"
              >
                Sign in / Sign up
              </button>
            )}
          </div>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-md border border-line text-foreground sm:hidden"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="border-t border-line bg-bg px-4 py-4 sm:hidden">
          <SearchForm className="w-full" onDone={() => setMenuOpen(false)} />
          <nav className="mt-3 flex flex-col" aria-label="Mobile">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className="rounded-md px-3 py-2.5 text-sm font-medium text-foreground/90 hover:bg-surface-2"
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="mt-3 flex items-center gap-3 border-t border-line pt-3">
            <NotificationBell />
            <TokenBalance />
            {session?.user ? (
              <div className="ml-auto">
                <UserMenu />
              </div>
            ) : (
              <button
                onClick={() => signIn(undefined, { callbackUrl: window.location.pathname })}
                className="ml-auto h-9 rounded-btn bg-brand px-4 text-sm font-semibold text-white"
              >
                Sign in
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
