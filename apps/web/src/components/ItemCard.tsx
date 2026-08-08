import Link from "next/link";
import { CATEGORY_LABELS, CONDITION_LABELS, ITEM_STATUS_LABELS } from "@swapify/shared";
import { itemValue, type ApiItem } from "@/lib/api";
import { Coins, ImageOff } from "lucide-react";

export default function ItemCard({ item }: { item: ApiItem }) {
  const img = item.images[0]?.url;
  const category = CATEGORY_LABELS[item.category as keyof typeof CATEGORY_LABELS] ?? item.category;
  const condition = CONDITION_LABELS[item.condition as keyof typeof CONDITION_LABELS] ?? item.condition;
  const status = ITEM_STATUS_LABELS[item.status] ?? item.status;
  const isActive = item.status === "ACTIVE";

  return (
    <Link
      href={`/items/${item.id}`}
      className="group overflow-hidden rounded-card border border-line bg-surface shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-primary/50 hover:shadow-raise"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-surface-2">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img}
            alt={item.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted">
            <ImageOff className="h-8 w-8 opacity-60" aria-hidden />
            <span className="text-xs">No photo yet</span>
          </div>
        )}
        <div className="absolute left-3 top-3">
          <span
            className={`rounded-pill border px-2.5 py-0.5 text-[11px] font-semibold backdrop-blur ${
              isActive
                ? "border-primary/30 bg-primary/15 text-primary-soft"
                : "border-line bg-surface/80 text-muted"
            }`}
          >
            {category}
          </span>
        </div>
        {!isActive && (
          <div className="absolute right-3 top-3">
            <span className="rounded-pill border border-line bg-surface/80 px-2.5 py-0.5 text-[11px] font-semibold text-muted backdrop-blur">
              {status}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 p-4">
        <h3 className="line-clamp-1 font-semibold text-foreground transition-colors group-hover:text-primary-soft">
          {item.title}
        </h3>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">{condition}</span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-token">
            <Coins className="h-4 w-4" aria-hidden />
            {itemValue(item)} tokens
          </span>
        </div>
      </div>
    </Link>
  );
}
