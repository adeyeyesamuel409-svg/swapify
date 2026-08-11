import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/auth";
import { fetchMe, fetchSwap, formatPence } from "@/lib/api";
import { SWAP_STATUS_LABELS } from "@swapify/shared";
import SwapActions from "@/components/SwapActions";
import SwapChat from "@/components/SwapChat";
import SwapTimeline from "@/components/SwapTimeline";
import RatingBox from "@/components/RatingBox";
import ItemImage from "@/components/ItemImage";
import { ArrowRight } from "lucide-react";

export const metadata = { title: "Swap - Swapify" };

const ACTIVE_STATUSES = ["REQUESTED", "AGREED", "PAID", "SHIPPED"];

export default async function SwapDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user || !session.accessToken)
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent(`/swaps/${id}`)}`);

  const [swapRes, meRes] = await Promise.all([
    fetchSwap(session.accessToken, id).catch(() => null),
    fetchMe(session.accessToken).catch(() => null),
  ]);

  if (!swapRes || !meRes) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 text-center sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Swap detail</h1>
        <p className="mt-3 text-muted">We couldn&apos;t load this swap right now. Please try again in a moment.</p>
      </main>
    );
  }

  const { swap } = swapRes;
  const { user } = meRes;

  if (swap.offeringUserId !== user.id && swap.requestedUserId !== user.id) notFound();

  const amOffering = swap.offeringUserId === user.id;
  const otherPartyName = amOffering ? swap.requestedUser.name : swap.offeringUser.name;
  const gapPence = swap.gapPence;
  const active = ACTIVE_STATUSES.includes(swap.status);
  const completed = swap.status === "COMPLETED";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6">
      <Link href="/swaps" className="text-sm font-medium text-primary-soft hover:text-foreground">
        &larr; My swaps
      </Link>

      <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground">Swap detail</h1>

      <div className="mt-5 rounded-card border border-line bg-surface p-5 shadow-card">
        <span className="inline-flex rounded-pill border border-line bg-surface-2 px-3 py-0.5 text-xs font-semibold text-foreground/90">
          {SWAP_STATUS_LABELS[swap.status] ?? swap.status}
        </span>

        <div className="mt-4">
          <SwapTimeline swap={swap} myUserId={user.id} />
        </div>

        <div className="mt-4 grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <div className="rounded-btn border border-line bg-surface-2 p-3">
            <p className="text-xs text-muted">{amOffering ? "You offer" : `${swap.offeringUser.name} offers`}</p>
            <div className="mt-2 aspect-[4/3] overflow-hidden rounded-btn border border-line bg-surface">
              {swap.offeringItem.images[0] ? (
                <ItemImage src={swap.offeringItem.images[0].url} alt={swap.offeringItem.title} />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted">No photo</div>
              )}
            </div>
            <Link href={`/items/${swap.offeringItem.id}`} className="mt-2 block truncate font-semibold text-primary-soft hover:underline">
              {swap.offeringItem.title}
            </Link>
            <p className="text-xs text-primary-soft">{formatPence(swap.offeringItem.valuePence)}</p>
          </div>
          <div className="hidden items-center justify-center sm:flex">
            <ArrowRight className="h-5 w-5 text-primary-soft" aria-hidden />
          </div>
          <div className="rounded-btn border border-line bg-surface-2 p-3">
            <p className="text-xs text-muted">{amOffering ? `${swap.requestedUser.name} offers` : "You receive"}</p>
            <div className="mt-2 aspect-[4/3] overflow-hidden rounded-btn border border-line bg-surface">
              {swap.requestedItem.images[0] ? (
                <ItemImage src={swap.requestedItem.images[0].url} alt={swap.requestedItem.title} />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted">No photo</div>
              )}
            </div>
            <Link href={`/items/${swap.requestedItem.id}`} className="mt-2 block truncate font-semibold text-primary-soft hover:underline">
              {swap.requestedItem.title}
            </Link>
            <p className="text-xs text-primary-soft">{formatPence(swap.requestedItem.valuePence)}</p>
          </div>
        </div>

        {gapPence > 0 && (
          <p className="mt-3 text-xs text-muted">
            Value gap: <span className="font-semibold text-token">{formatPence(gapPence)}</span>
          </p>
        )}
        {swap.payment?.status === "PAID" && (
          <p className="mt-1 text-xs text-emerald-400">Payment received - value gap settled.</p>
        )}
        {swap.expiresAt && active && (
          <p className="mt-1 text-xs text-muted">
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
