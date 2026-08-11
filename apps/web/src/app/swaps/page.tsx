import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/auth";
import { fetchMe, fetchSwaps, formatPence, type ApiSwap } from "@/lib/api";
import { SWAP_STATUS_LABELS } from "@swapify/shared";
import SwapActions from "@/components/SwapActions";

export const metadata = { title: "My Swaps - Swapify" };

function SwapCard({ swap, accessToken, myUserId }: { swap: ApiSwap; accessToken: string; myUserId: string }) {
  const amOffering = swap.offeringUserId === myUserId;
  const gapPence = swap.gapPence;
  const statusColor: Record<string, string> = {
    REQUESTED: "text-amber-300 border-amber-500/40 bg-amber-950",
    AGREED: "text-sky-300 border-sky-500/40 bg-sky-950",
    PAID: "text-emerald-300 border-emerald-500/40 bg-emerald-950",
    COMPLETED: "text-emerald-300 border-emerald-500/40 bg-emerald-950",
    CANCELLED: "text-muted border-line bg-surface-2",
    EXPIRED: "text-muted border-line bg-surface-2",
  };

  const paymentLabel =
    swap.payment?.status === "PAID"
      ? "Value-gap payment received"
      : swap.payment?.status === "PENDING"
        ? "Payment pending"
        : null;

  return (
    <div className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <span className={`rounded-pill border px-3 py-0.5 text-xs font-semibold ${statusColor[swap.status] ?? "text-muted border-line bg-surface-2"}`}>
          {SWAP_STATUS_LABELS[swap.status] ?? swap.status}
        </span>
        <span className="text-xs text-muted">
          {new Date(swap.createdAt).toLocaleDateString()}
        </span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-btn border border-line bg-surface-2 p-3">
          <p className="text-xs text-muted">{amOffering ? "You offer" : `${swap.offeringUser.name} offers`}</p>
          <Link href={`/items/${swap.offeringItem.id}`} className="mt-1 block truncate font-semibold text-primary-soft hover:underline">
            {swap.offeringItem.title}
          </Link>
          <p className="text-xs text-primary-soft">{formatPence(swap.offeringItem.valuePence)}</p>
        </div>
        <div className="rounded-btn border border-line bg-surface-2 p-3">
          <p className="text-xs text-muted">{amOffering ? `${swap.requestedUser.name} offers` : "You receive"}</p>
          <Link href={`/items/${swap.requestedItem.id}`} className="mt-1 block truncate font-semibold text-primary-soft hover:underline">
            {swap.requestedItem.title}
          </Link>
          <p className="text-xs text-primary-soft">{formatPence(swap.requestedItem.valuePence)}</p>
        </div>
      </div>

      {gapPence > 0 && (
        <p className="mt-3 text-xs text-muted">
          Value gap: <span className="font-semibold text-token">{formatPence(gapPence)}</span> paid by{" "}
          {amOffering
            ? swap.gapPayer === "OFFERING_USER"
              ? "you"
              : swap.requestedUser.name
            : swap.gapPayer === "REQUESTING_USER"
              ? "you"
              : swap.offeringUser.name}
        </p>
      )}

      {paymentLabel && (
        <p className="mt-2 inline-block rounded-pill bg-emerald-950 px-2 py-0.5 text-xs font-semibold text-emerald-300">
          {paymentLabel}
        </p>
      )}

      <SwapActions swap={swap} accessToken={accessToken} myUserId={myUserId} />

      <div className="mt-3 flex items-center gap-4 text-xs">
        <Link href={`/swaps/${swap.id}`} className="font-semibold text-primary-soft hover:underline">
          View details &amp; chat
        </Link>
        {swap.status === "COMPLETED" && (
          <Link href={`/swaps/${swap.id}`} className="text-muted hover:text-foreground">
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
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent("/swaps")}`);
  }

  let swaps: ApiSwap[] = [];
  let userId = "";
  let loadError = "";
  try {
    const results = await Promise.all([fetchSwaps(session.accessToken), fetchMe(session.accessToken)]);
    swaps = results[0].swaps;
    userId = results[1].user.id;
  } catch {
    loadError = "We couldn't load your swaps right now.";
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">My swaps</h1>

      {loadError ? (
        <div className="mt-8 rounded-card border border-rose-500/40 bg-rose-950/30 p-10 text-center">
          <p className="text-foreground">{loadError}</p>
          <p className="mt-1 text-sm text-muted">Please try again in a moment.</p>
        </div>
      ) : swaps.length === 0 ? (
        <div className="mt-8 rounded-card border border-line bg-surface p-10 text-center">
          <p className="text-muted">No swaps yet.</p>
          <Link href="/browse" className="mt-2 inline-block text-sm font-semibold text-primary-soft hover:text-foreground">
            Browse items to swap
          </Link>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          {swaps.map((swap) => (
            <SwapCard key={swap.id} swap={swap} accessToken={session.accessToken!} myUserId={userId} />
          ))}
        </div>
      )}
    </main>
  );
}
