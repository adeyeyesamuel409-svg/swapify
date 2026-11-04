"use client";

import { useState } from "react";
import Link from "next/link";
import { CATEGORY_LABELS, CONDITION_LABELS, ITEM_STATUS_LABELS } from "@swapify/shared";
import { formatPence, timeAgo, type ApiItem } from "@/lib/api";
import { mockProximity, mockTradePreference, mockTrust, mockVerification } from "@/lib/mock";
import ItemImage from "@/components/ItemImage";
import SwapBuilder from "@/components/swap/SwapBuilder";
import { BadgeCheck, Clock, MapPin, Repeat, Star } from "lucide-react";

export default function ItemCard({ item }: { item: ApiItem }) {
  const [builderOpen, setBuilderOpen] = useState(false);
  const category = CATEGORY_LABELS[item.category as keyof typeof CATEGORY_LABELS] ?? item.category;
  const condition = CONDITION_LABELS[item.condition as keyof typeof CONDITION_LABELS] ?? item.condition;
  const status = ITEM_STATUS_LABELS[item.status] ?? item.status;
  const isActive = item.status === "ACTIVE";
  const value = formatPence(item.valuePence);
  const distance = mockProximity(item.id);
  const trust = mockTrust(item.owner.id);
  const pref = mockTradePreference(item.id);
  const verification = mockVerification(item.owner.id);

  return (
    <>
      <article className="group relative flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-raise">
        {/* stretched link layer (avoids nested interactive elements) */}
        <Link
          href={`/items/${item.id}`}
          className="absolute inset-0 z-[1]"
          aria-label={item.title}
        />

        <div className="relative aspect-[4/3] overflow-hidden bg-surface-2">
          {item.images[0] ? (
            <ItemImage
              src={item.images[0].url}
              alt={item.title}
              className="transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted">
              <span className="text-xs">No photo yet</span>
            </div>
          )}

          {/* trade preference overlay tag */}
          <div className="absolute left-3 top-3">
            <span
              className={`inline-flex items-center gap-1 rounded-pill border px-2.5 py-0.5 text-[11px] font-semibold backdrop-blur ${
                pref === "cash"
                  ? "border-token/40 bg-bg/85 text-token"
                  : "border-primary/30 bg-bg/85 text-primary-soft"
              }`}
            >
              <Repeat className="h-3 w-3" aria-hidden />
              {pref === "cash" ? "Open to Cash + Trade" : "Open to Trades"}
            </span>
          </div>

          {/* proximity badge */}
          <div className="absolute right-3 top-3">
            <span className="inline-flex items-center gap-1 rounded-pill border border-line bg-bg/85 px-2.5 py-0.5 text-[11px] font-semibold text-foreground backdrop-blur">
              <MapPin className="h-3 w-3 text-primary-soft" aria-hidden />
              {distance}
            </span>
          </div>

          {!isActive && (
            <div className="absolute right-3 top-11">
              <span className="rounded-pill border border-line bg-bg/85 px-2.5 py-0.5 text-[11px] font-semibold text-muted backdrop-blur">
                {status}
              </span>
            </div>
          )}

          <div className="absolute bottom-3 left-3">
            <span className="inline-flex items-center gap-1 rounded-pill border border-token/40 bg-bg/85 px-2.5 py-1 text-xs font-bold text-token shadow-card backdrop-blur">
              {value}
            </span>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-2 p-4">
          <h3 className="line-clamp-1 font-semibold text-navy transition-colors group-hover:text-primary-soft">
            {item.title}
          </h3>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">{condition}</span>
            <span className="text-muted/70">Listed {timeAgo(item.createdAt)}</span>
          </div>

          {/* trust + category */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-1 text-muted">
              <Star className="h-3.5 w-3.5 fill-token-soft text-token-soft" aria-hidden />
              <span className="font-semibold text-foreground">{trust.rating}</span>
              <span className="text-muted/70">({trust.swaps} swaps)</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[10px] font-semibold ${
                  verification.idVerified
                    ? "border-sky-500/40 bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
                    : "border-amber-500/40 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                }`}
              >
                {verification.idVerified ? (
                  <BadgeCheck className="h-3 w-3" aria-hidden />
                ) : (
                  <Clock className="h-3 w-3" aria-hidden />
                )}
                {verification.idVerified ? "ID verified" : "ID pending"}
              </span>
              <span className="rounded-pill border border-line bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted">
                {category}
              </span>
            </span>
          </div>

          <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-surface-2 text-[10px] font-bold text-primary-soft">
                {item.owner.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.owner.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  item.owner.name.slice(0, 1).toUpperCase()
                )}
              </span>
              <span className="truncate text-xs text-muted">{item.owner.name}</span>
              {verification.verified && (
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded-pill border border-emerald-500/40 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  <BadgeCheck className="h-2.5 w-2.5" aria-hidden />
                  Verified
                </span>
              )}
            </span>
            {isActive && (
              <button
                type="button"
                onClick={() => setBuilderOpen(true)}
                className="relative z-[2] inline-flex items-center gap-1 rounded-pill border border-primary/40 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold text-primary-soft transition-all hover:scale-[1.03] hover:bg-primary hover:text-white"
              >
                <Repeat className="h-3 w-3" aria-hidden />
                Propose Swap
              </button>
            )}
          </div>
        </div>
      </article>

      {builderOpen && <SwapBuilder targetItem={item} onClose={() => setBuilderOpen(false)} />}
    </>
  );
}
