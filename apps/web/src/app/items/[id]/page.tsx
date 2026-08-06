import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { fetchItem, fetchMe, itemValue } from "@/lib/api";
import { CATEGORY_LABELS, CONDITION_LABELS } from "@swapify/shared";
import SwapRequestButton from "@/components/SwapRequestButton";

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let item;
  try {
    ({ item } = await fetchItem(id));
  } catch {
    notFound();
  }

  // Show the swap button only when the viewer doesn't own this listing.
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
    <main className="mx-auto max-w-5xl flex-1 px-6 py-8">
      <Link href="/browse" className="text-sm text-indigo-400 hover:underline">
        &larr; Back to browse
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <div>
          {mainImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mainImage} alt={item.title} className="w-full rounded-xl border border-gray-700 object-cover" />
          ) : (
            <div className="flex h-96 w-full items-center justify-center rounded-xl border border-gray-700 bg-gray-900 text-gray-500">
              No photo
            </div>
          )}
          {item.images.length > 1 && (
            <div className="mt-3 grid grid-cols-4 gap-3">
              {item.images.map((img) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={img.id} src={img.url} alt="" className="h-20 w-full rounded-md border border-gray-700 object-cover" />
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="text-sm text-indigo-400">
            {CATEGORY_LABELS[item.category as keyof typeof CATEGORY_LABELS] ?? item.category}
          </p>
          <h1 className="mt-1 text-3xl font-bold text-white">{item.title}</h1>
          <p className="mt-2 text-sm text-gray-400">
            Condition: {CONDITION_LABELS[item.condition as keyof typeof CONDITION_LABELS] ?? item.condition} &middot; Listed by {item.owner.name}
          </p>

          <div className="mt-4 rounded-xl border border-indigo-500/30 bg-indigo-950 p-4">
            <p className="text-sm text-indigo-300">Value</p>
            <p className="text-2xl font-bold text-white">{itemValue(item)} tokens</p>
            <p className="mt-1 text-xs text-indigo-400">The value used to balance swap differences.</p>
          </div>

          <p className="mt-6 whitespace-pre-line text-gray-300">{item.description}</p>

          {!isOwnItem && <SwapRequestButton itemId={item.id} itemValueTokens={itemValue(item)} />}
        </div>
      </div>
    </main>
  );
}
