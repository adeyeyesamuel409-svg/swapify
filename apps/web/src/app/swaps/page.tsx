import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/auth";
import { fetchMe, fetchSwaps, itemValue, type ApiSwap } from "@/lib/api";
import { SWAP_STATUS_LABELS } from "@swapify/shared";
import SwapActions from "@/components/SwapActions";

export const metadata = { title: "My Swaps - Swapify" };

function SwapCard({ swap, accessToken, myUserId }: { swap: ApiSwap; accessToken: string; myUserId: string }) {
  const amOffering = swap.offeringUserId === myUserId;
  const gapTokens = Number(BigInt(swap.gapMicroTokens)) / 1_000_000;
  const statusColor: Record<string, string> = {
    REQUESTED: "text-amber-300 border-amber-500/40 bg-amber-950",
    AGREED: "text-sky-300 border-sky-500/40 bg-sky-950",
    ESCROWED: "text-emerald-300 border-emerald-500/40 bg-emerald-950",
    COMPLETED: "text-emerald-300 border-emerald-500/40 bg-emerald-950",
    CANCELLED: "text-gray-400 border-gray-600 bg-gray-800",
    EXPIRED: "text-gray-400 border-gray-600 bg-gray-800",
  };

  const escrowLabel =
    swap.escrow?.status === "HELD"
      ? `Tokens held in escrow: ${Number(BigInt(swap.escrow.amountMicroTokens)) / 1_000_000}`
      : swap.escrow?.status === "RELEASED"
        ? "Escrow released"
        : swap.escrow?.status === "REFUNDED"
          ? "Escrow refunded"
          : null;

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800 p-5">
      <div className="flex items-center justify-between gap-3">
        <span className={`rounded-full border px-3 py-0.5 text-xs font-semibold ${statusColor[swap.status] ?? "text-gray-300 border-gray-600 bg-gray-800"}`}>
          {SWAP_STATUS_LABELS[swap.status] ?? swap.status}
        </span>
        <span className="text-xs text-gray-500">
          {new Date(swap.createdAt).toLocaleDateString()}
        </span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-3">
          <p className="text-xs text-gray-500">{amOffering ? "You offer" : `${swap.offeringUser.name} offers`}</p>
          <Link href={`/items/${swap.offeringItem.id}`} className="mt-1 block truncate font-semibold text-indigo-300 hover:underline">
            {swap.offeringItem.title}
          </Link>
          <p className="text-xs text-indigo-300">{itemValue(swap.offeringItem)} tokens</p>
        </div>
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-3">
          <p className="text-xs text-gray-500">{amOffering ? `${swap.requestedUser.name} offers` : "You receive"}</p>
          <Link href={`/items/${swap.requestedItem.id}`} className="mt-1 block truncate font-semibold text-indigo-300 hover:underline">
            {swap.requestedItem.title}
          </Link>
          <p className="text-xs text-indigo-300">{itemValue(swap.requestedItem)} tokens</p>
        </div>
      </div>

      {gapTokens > 0 && (
        <p className="mt-3 text-xs text-gray-400">
          Value gap: <span className="font-semibold text-amber-300">{gapTokens} tokens</span> paid by{" "}
          {amOffering
            ? swap.gapPayer === "OFFERING_USER"
              ? "you"
              : swap.requestedUser.name
            : swap.gapPayer === "REQUESTING_USER"
              ? "you"
              : swap.offeringUser.name}
        </p>
      )}

      {escrowLabel && (
        <p className="mt-2 inline-block rounded bg-emerald-950 px-2 py-0.5 text-xs font-semibold text-emerald-300">
          {escrowLabel}
        </p>
      )}

      <SwapActions swap={swap} accessToken={accessToken} myUserId={myUserId} />

      <div className="mt-3 flex items-center gap-4 text-xs">
        <Link href={`/swaps/${swap.id}`} className="font-semibold text-indigo-400 hover:underline">
          View details &amp; chat
        </Link>
        {swap.status === "COMPLETED" && (
          <Link href={`/swaps/${swap.id}`} className="text-gray-400 hover:text-gray-200">
            Rate this swap
          </Link>
        )}
      </div>
    </div>
  );
}

export default async function SwapsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || !session.accessToken) {
    redirect("/api/auth/signin");
  }

  const [{ swaps }, { user }] = await Promise.all([
    fetchSwaps(session.accessToken),
    fetchMe(session.accessToken),
  ]);

  return (
    <main className="mx-auto max-w-3xl flex-1 px-6 py-12">
      <h1 className="text-3xl font-bold text-white">My swaps</h1>

      {swaps.length === 0 ? (
        <div className="mt-8 rounded-xl border border-gray-700 bg-gray-800 p-10 text-center">
          <p className="text-gray-400">No swaps yet.</p>
          <Link href="/browse" className="mt-2 inline-block text-sm font-semibold text-indigo-400 hover:underline">
            Browse items to swap
          </Link>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          {swaps.map((swap) => (
            <SwapCard key={swap.id} swap={swap} accessToken={session.accessToken!} myUserId={user.id} />
          ))}
        </div>
      )}
    </main>
  );
}
