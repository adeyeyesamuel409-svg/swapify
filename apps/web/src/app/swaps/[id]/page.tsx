import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/auth";
import { fetchMe, fetchSwap, itemValue } from "@/lib/api";
import { SWAP_STATUS_LABELS } from "@swapify/shared";
import SwapActions from "@/components/SwapActions";
import SwapChat from "@/components/SwapChat";
import RatingBox from "@/components/RatingBox";

export const metadata = { title: "Swap - Swapify" };

const ACTIVE_STATUSES = ["REQUESTED", "AGREED", "ESCROWED", "SHIPPED"];

export default async function SwapDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !session.accessToken) redirect("/api/auth/signin");

  const { id } = await params;
  const [{ swap }, { user }] = await Promise.all([
    fetchSwap(session.accessToken, id),
    fetchMe(session.accessToken),
  ]);

  if (swap.offeringUserId !== user.id && swap.requestedUserId !== user.id) notFound();

  const amOffering = swap.offeringUserId === user.id;
  const otherPartyName = amOffering ? swap.requestedUser.name : swap.offeringUser.name;
  const gapTokens = Number(BigInt(swap.gapMicroTokens)) / 1_000_000;
  const active = ACTIVE_STATUSES.includes(swap.status);
  const completed = swap.status === "COMPLETED";

  return (
    <main className="mx-auto max-w-3xl flex-1 px-6 py-12">
      <Link href="/swaps" className="text-sm text-indigo-400 hover:underline">
        &larr; My swaps
      </Link>

      <h1 className="mt-3 text-2xl font-bold text-white">Swap detail</h1>

      <div className="mt-5 rounded-xl border border-gray-700 bg-gray-800 p-5">
        <span className="rounded-full border border-gray-600 bg-gray-900 px-3 py-0.5 text-xs font-semibold text-gray-200">
          {SWAP_STATUS_LABELS[swap.status] ?? swap.status}
        </span>

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
            Value gap: <span className="font-semibold text-amber-300">{gapTokens} tokens</span>
          </p>
        )}
        {swap.expiresAt && active && (
          <p className="mt-1 text-xs text-gray-500">
            Expires {new Date(swap.expiresAt).toLocaleString()}
          </p>
        )}

        <SwapActions swap={swap} accessToken={session.accessToken!} myUserId={user.id} />
      </div>

      <SwapChat swapId={swap.id} accessToken={session.accessToken!} myUserId={user.id} active={active} />
      {completed && (
        <RatingBox swapId={swap.id} accessToken={session.accessToken!} myUserId={user.id} otherPartyName={otherPartyName} />
      )}
    </main>
  );
}
