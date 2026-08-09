import { ArrowRight, Coins } from "lucide-react";
import Button from "../Button";
import SectionHeader from "../SectionHeader";
import type { ApiItem } from "@/lib/api";
import { itemValue, resolveImageUrl } from "@/lib/api";

function MiniItem({ item, side }: { item: ApiItem; side: "left" | "right" }) {
  const img = item.images[0]?.url;
  return (
    <div
      className={`flex w-full max-w-[220px] flex-col overflow-hidden rounded-card border border-line bg-surface-2 shadow-card ${
        side === "right" ? "lg:rotate-2" : "lg:-rotate-2"
      }`}
    >
      <div className="h-28 bg-surface-3">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={resolveImageUrl(img)} alt={item.title} className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="p-3">
        <p className="line-clamp-1 text-sm font-semibold text-foreground">{item.title}</p>
        <p className="mt-0.5 text-xs text-token">{itemValue(item)} tokens</p>
      </div>
    </div>
  );
}

export default function TokensExplainerSection({ items }: { items: ApiItem[] }) {
  const a = items.find((i) => i.images.length > 0);
  const b = items.find((i) => i !== a && i.images.length > 0);

  if (!a || !b) return null;

  const aVal = itemValue(a);
  const bVal = itemValue(b);
  const gap = Math.abs(aVal - bVal);
  const [higher, lower] = aVal >= bVal ? [a, b] : [b, a];

  return (
    <section id="tokens" className="border-y border-line bg-surface">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:px-8">
        <div>
          <SectionHeader
            eyebrow="What are tokens?"
            title="Fair trades when values don't match"
            description="Every item gets a token value. Swapping never needs cash — the party getting the higher-value item pays the difference in tokens, held safely in escrow until both sides confirm."
          />
          <ul className="mt-6 space-y-3 text-sm text-muted">
            <li className="flex items-center gap-3">
              <Coins className="h-4 w-4 shrink-0 text-token" aria-hidden />
              Buy tokens any time to top up your balance.
            </li>
            <li className="flex items-center gap-3">
              <Coins className="h-4 w-4 shrink-0 text-token" aria-hidden />
              Tokens are locked during a swap, never double-spent.
            </li>
            <li className="flex items-center gap-3">
              <Coins className="h-4 w-4 shrink-0 text-token" aria-hidden />
              Both sides confirm before tokens are released.
            </li>
          </ul>
          <div className="mt-8">
            <Button href="/tokens" size="lg">
              Buy tokens
              <ArrowRight className="h-4.5 w-4.5" aria-hidden />
            </Button>
          </div>
        </div>

        <div className="flex flex-col items-center gap-6">
          <div className="flex items-center gap-4">
            <MiniItem item={higher} side="left" />
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill border border-line bg-bg text-lg font-bold text-foreground">
              ⇄
            </div>
            <MiniItem item={lower} side="right" />
          </div>
          <div className="flex items-center gap-2 rounded-card border border-token/30 bg-token/10 px-5 py-3">
            <Coins className="h-5 w-5 text-token" aria-hidden />
            <p className="text-sm text-foreground">
              Value gap of <span className="font-bold text-token">{gap} tokens</span> — paid by whoever
              receives the higher-value item.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
