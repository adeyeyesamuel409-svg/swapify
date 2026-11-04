"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useSession, signIn } from "next-auth/react";
import { Check, ImageOff, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { createSwap, fetchMyItems, formatPence, type ApiItem } from "@/lib/api";
import ItemImage from "@/components/ItemImage";
import TradeFairnessMeter from "./TradeFairnessMeter";
import CashTopUpStepper from "./CashTopUpStepper";

export default function SwapBuilder({
  targetItem,
  onClose,
}: {
  targetItem: ApiItem;
  onClose: () => void;
}) {
  const { data: session, status } = useSession();
  const reduce = useReducedMotion();
  const [myItems, setMyItems] = useState<ApiItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    if (session?.accessToken) {
      fetchMyItems(session.accessToken)
        .then(({ items }) => setMyItems(items.filter((i) => i.status === "ACTIVE")))
        .catch(() => setError("Could not load your items"));
    }
  }, [session?.accessToken]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const selected = myItems.find((i) => i.id === selectedId);

  const submit = async () => {
    if (!session?.accessToken || !selected) return;
    setError("");
    setSubmitting(true);
    try {
      const { swap } = await createSwap(session.accessToken, {
        offeringItemId: selected.id,
        requestedItemId: targetItem.id,
      });
      setCreated(swap.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send swap request");
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="swap-builder"
        className="fixed inset-0 z-50 flex items-end justify-center bg-navy/50 p-0 backdrop-blur-sm sm:items-center sm:p-6"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label="Propose a swap"
      >
        <motion.div
          className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-card border border-line bg-surface shadow-raise sm:rounded-card"
          initial={reduce ? false : { opacity: 0, y: 32, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? undefined : { opacity: 0, y: 24, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 240, damping: 26 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-soft">Swap builder</p>
              <h2 className="mt-1 text-xl font-bold text-navy">Propose a swap</h2>
              <p className="mt-1 text-sm text-muted">
                Offer one of your items. Value gaps settle as a secure cash top-up.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close swap builder"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill border border-line text-muted transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            {status === "loading" ? (
              <p className="py-10 text-center text-sm text-muted">Loading…</p>
            ) : !session?.accessToken ? (
              <div className="py-10 text-center">
                <p className="text-sm text-muted">Sign in to propose a swap.</p>
                <button
                  type="button"
                  onClick={() => signIn(undefined, { callbackUrl: window.location.pathname })}
                  className="mt-4 rounded-btn bg-brand px-5 py-2.5 font-semibold text-white shadow-glow transition-all hover:scale-[1.02]"
                >
                  Sign in
                </button>
                <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted">
                  <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden />
                  Secure &amp; encrypted — your details are never shared
                </p>
              </div>
            ) : created ? (
              <div className="py-10 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/15">
                  <Check className="h-6 w-6 text-success" aria-hidden />
                </div>
                <p className="mt-4 font-semibold text-navy">Swap request sent</p>
                <p className="mt-1 text-sm text-muted">Awaiting the owner&apos;s decision.</p>
                <Link href="/swaps" className="mt-4 inline-block text-sm font-semibold text-primary-soft underline">
                  View your swaps
                </Link>
              </div>
            ) : (
              <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
                {/* Left: your offer */}
                <div>
                  <h3 className="text-sm font-semibold text-navy">Your offer</h3>
                  <p className="mt-0.5 text-xs text-muted">Pick one of your active listings.</p>
                  {myItems.length === 0 ? (
                    <p className="mt-3 rounded-card border border-dashed border-line bg-surface-2 p-4 text-sm text-muted">
                      You need an active listing to offer.{" "}
                      <Link href="/post" className="font-semibold text-primary-soft underline">
                        Post an item
                      </Link>
                    </p>
                  ) : (
                    <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                      {myItems.map((i) => {
                        const active = selectedId === i.id;
                        return (
                          <button
                            key={i.id}
                            type="button"
                            onClick={() => setSelectedId(active ? "" : i.id)}
                            aria-pressed={active}
                            className={`group relative overflow-hidden rounded-btn border bg-surface text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                              active
                                ? "border-primary shadow-glow ring-2 ring-primary/25"
                                : "border-line hover:-translate-y-0.5 hover:border-primary/50"
                            }`}
                          >
                            <div className="relative aspect-[4/3] overflow-hidden bg-surface-2">
                              {i.images[0] ? (
                                <ItemImage src={i.images[0].url} alt={i.title} />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-muted">
                                  <ImageOff className="h-5 w-5 opacity-60" aria-hidden />
                                </div>
                              )}
                              {active && (
                                <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white">
                                  <Check className="h-3 w-3" aria-hidden />
                                </span>
                              )}
                            </div>
                            <div className="p-2">
                              <p className="truncate text-xs font-medium text-foreground">{i.title}</p>
                              <p className="text-[11px] font-semibold text-token">{formatPence(i.valuePence)}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Right: their item + balancing engine */}
                <div className="flex flex-col gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-navy">Their item</h3>
                    <div className="mt-3 overflow-hidden rounded-card border border-line bg-surface">
                      <div className="aspect-[4/3] bg-surface-2">
                        {targetItem.images[0] ? (
                          <ItemImage src={targetItem.images[0].url} alt={targetItem.title} />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-muted">
                            <ImageOff className="h-5 w-5 opacity-60" aria-hidden />
                          </div>
                        )}
                      </div>
                      <div className="p-3">
                        <p className="truncate text-sm font-semibold text-navy">{targetItem.title}</p>
                        <p className="text-xs font-semibold text-token">{formatPence(targetItem.valuePence)}</p>
                      </div>
                    </div>
                  </div>

                  {selected && (
                    <div className="flex flex-col gap-4">
                      <TradeFairnessMeter
                        myValuePence={selected.valuePence}
                        targetValuePence={targetItem.valuePence}
                      />
                      <CashTopUpStepper
                        myValuePence={selected.valuePence}
                        targetValuePence={targetItem.valuePence}
                        myTitle={selected.title}
                        targetTitle={targetItem.title}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Sticky action bar */}
          {session?.accessToken && !created && (
            <div className="border-t border-line bg-surface/95 px-5 py-4 backdrop-blur sm:px-6">
              {error && <p className="mb-2 text-sm text-danger">{error}</p>}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted">
                  {selected
                    ? `Offering “${selected.title}” for “${targetItem.title}”`
                    : "Select one of your items to continue"}
                </p>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!selectedId || submitting}
                  className="rounded-btn bg-brand px-6 py-2.5 font-semibold text-white shadow-glow transition-all hover:scale-[1.02] hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
                >
                  {submitting ? "Sending…" : "Propose swap"}
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
