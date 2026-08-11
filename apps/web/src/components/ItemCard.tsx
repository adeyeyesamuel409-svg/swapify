import Link from "next/link";
import { CATEGORY_LABELS, CONDITION_LABELS, ITEM_STATUS_LABELS } from "@swapify/shared";
import { formatPence, timeAgo, type ApiItem } from "@/lib/api";
import ItemImage from "@/components/ItemImage";
import { Repeat } from "lucide-react";

export default function ItemCard({ item }: { item: ApiItem }) {
  const category = CATEGORY_LABELS[item.category as keyof typeof CATEGORY_LABELS] ?? item.category;
  const condition = CONDITION_LABELS[item.condition as keyof typeof CONDITION_LABELS] ?? item.condition;
  const status = ITEM_STATUS_LABELS[item.status] ?? item.status;
  const isActive = item.status === "ACTIVE";
  const value = formatPence(item.valuePence);

  return (
    <Link
      href={`/items/${item.id}`}
      className="group flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-primary/50 hover:shadow-raise"
    >
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
        <div className="absolute bottom-3 left-3">
          <span className="inline-flex items-center gap-1 rounded-pill border border-token/40 bg-bg/85 px-2.5 py-1 text-xs font-bold text-token shadow-card backdrop-blur">
            {value}
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-1 font-semibold text-foreground transition-colors group-hover:text-primary-soft">
          {item.title}
        </h3>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">{condition}</span>
          <span className="text-muted/70">Listed {timeAgo(item.createdAt)}</span>
        </div>

        <div className="mt-auto flex items-center justify-between border-t border-line pt-3">
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
          </span>
          <span className="inline-flex items-center gap-1 rounded-pill border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary-soft transition-colors group-hover:bg-primary/20">
            <Repeat className="h-3 w-3" aria-hidden />
            Swap
          </span>
        </div>
      </div>
    </Link>
  );
}
