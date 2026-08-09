import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import {
  fetchItem,
  fetchItems,
  fetchMe,
  fetchWishlists,
  fetchWishlistMatches,
  itemValue,
  timeAgo,
  type ApiItem,
} from "@/lib/api";
import { CATEGORY_LABELS, CONDITION_LABELS } from "@swapify/shared";
import SwapRequestButton from "@/components/SwapRequestButton";
import ItemGallery from "@/components/ItemGallery";
import ItemCard from "@/components/ItemCard";
import SellerCard from "@/components/SellerCard";
import { ArrowLeft, Coins, Sparkles } from "lucide-react";

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let item;
  try {
    ({ item } = await fetchItem(id));
  } catch {
    notFound();
  }

  const session = await getServerSession(authOptions);
  let viewerId: string | null = null;
  if (session?.accessToken) {
    try {
      ({ user: { id: viewerId } } = await fetchMe(session.accessToken));
    } catch {
      viewerId = null;
    }
  }
  const isOwnItem = item.owner.id === viewerId;

  // Which of the viewer's wishlists does this listing match? Reuses the API's
  // real keyword/category/value matcher.
  let matchedWishlists: { id: string; title: string }[] = [];
  if (session?.accessToken && !isOwnItem) {
    try {
      const { wishlists } = await fetchWishlists(session.accessToken);
      if (wishlists.length > 0) {
        const results = await Promise.all(
          wishlists.map(async (w) => {
            try {
              const { matches } = await fetchWishlistMatches(session.accessToken!, w.id);
              return { w, found: matches.some((m) => m.id === item.id) };
            } catch {
              return { w, found: false };
            }
          }),
        );
        matchedWishlists = results.filter((r) => r.found).map((r) => ({ id: r.w.id, title: r.w.title }));
      }
    } catch {
      matchedWishlists = [];
    }
  }

  // Related listings from the same category.
  let related: ApiItem[] = [];
  try {
    const result = await fetchItems({ category: item.category, pageSize: 5 });
    related = result.items.filter((i) => i.status === "ACTIVE" && i.id !== item.id).slice(0, 4);
  } catch {
    related = [];
  }

  const categoryLabel = CATEGORY_LABELS[item.category as keyof typeof CATEGORY_LABELS] ?? item.category;
  const conditionLabel = CONDITION_LABELS[item.condition as keyof typeof CONDITION_LABELS] ?? item.condition;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
      <Link href="/browse" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-soft hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to browse
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <div>
          <ItemGallery images={item.images} alt={item.title} />
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-primary-soft">{categoryLabel}</p>
            {isOwnItem && (
              <span className="rounded-pill border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary-soft">
                Your listing
              </span>
            )}
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">{item.title}</h1>
          <p className="mt-2 text-sm text-muted">
            {conditionLabel} &middot; Listed by {item.owner.name} &middot; {timeAgo(item.createdAt)}
          </p>

          <div className="lg:sticky lg:top-24">
            <div className="mt-4 rounded-card border border-token/30 bg-token/10 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm text-token">Value</p>
                <p className="text-xs text-muted">Used to balance swap differences</p>
              </div>
              <p className="mt-1 inline-flex items-center gap-1.5 text-2xl font-bold text-token">
                <Coins className="h-5 w-5" aria-hidden />
                {itemValue(item)} tokens
              </p>
            </div>

            {!isOwnItem &&
              (session?.accessToken ? (
                <SwapRequestButton itemId={item.id} itemTitle={item.title} itemValueTokens={itemValue(item)} />
              ) : (
                <Link
                  href={`/api/auth/signin?callbackUrl=${encodeURIComponent(`/items/${item.id}`)}`}
                  className="mt-4 flex w-full items-center justify-center rounded-btn bg-brand px-4 py-3 font-semibold text-white shadow-glow transition-all hover:brightness-110"
                >
                  Sign in to request this swap
                </Link>
              ))}
          </div>

          {matchedWishlists.length > 0 && (
            <div className="mt-4 rounded-card border border-emerald-500/30 bg-emerald-950/40 p-3">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Matches your wishlist
              </p>
              <p className="mt-1 text-xs text-emerald-200/80">
                {matchedWishlists.map((w) => w.title).join(", ")} — send a swap request to make it yours.
              </p>
            </div>
          )}

          <p className="mt-6 whitespace-pre-line text-foreground/90">{item.description}</p>

          {!isOwnItem && <SellerCard sellerId={item.owner.id} sellerName={item.owner.name} sellerImageUrl={item.owner.imageUrl} />}
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-14" aria-label="Similar listings">
          <h2 className="text-xl font-bold tracking-tight text-foreground">Similar listings</h2>
          <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((r) => (
              <ItemCard key={r.id} item={r} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
