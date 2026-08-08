import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { fetchItem, fetchMe, itemValue } from "@/lib/api";
import { CATEGORY_LABELS, CONDITION_LABELS } from "@swapify/shared";
import SwapRequestButton from "@/components/SwapRequestButton";
import { ArrowLeft, Coins } from "lucide-react";

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

  const mainImage = item.images[0]?.url;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
      <Link href="/browse" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-soft hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to browse
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <div>
          {mainImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mainImage} alt={item.title} className="w-full rounded-card border border-line object-cover" />
          ) : (
            <div className="flex h-96 w-full items-center justify-center rounded-card border border-line bg-surface-2 text-muted">
              No photo
            </div>
          )}
          {item.images.length > 1 && (
            <div className="mt-3 grid grid-cols-4 gap-3">
              {item.images.map((img) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={img.id} src={img.url} alt="" className="h-20 w-full rounded-card border border-line object-cover" />
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-primary-soft">
            {CATEGORY_LABELS[item.category as keyof typeof CATEGORY_LABELS] ?? item.category}
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">{item.title}</h1>
          <p className="mt-2 text-sm text-muted">
            Condition: {CONDITION_LABELS[item.condition as keyof typeof CONDITION_LABELS] ?? item.condition} &middot; Listed by {item.owner.name}
          </p>

          <div className="mt-4 rounded-card border border-token/30 bg-token/10 p-4">
            <p className="text-sm text-token">Value</p>
            <p className="inline-flex items-center gap-1.5 text-2xl font-bold text-token">
              <Coins className="h-5 w-5" aria-hidden />
              {itemValue(item)} tokens
            </p>
            <p className="mt-1 text-xs text-muted">The value used to balance swap differences.</p>
          </div>

          <p className="mt-6 whitespace-pre-line text-foreground/90">{item.description}</p>

          {!isOwnItem && <SwapRequestButton itemId={item.id} itemValueTokens={itemValue(item)} />}
        </div>
      </div>
    </main>
  );
}
