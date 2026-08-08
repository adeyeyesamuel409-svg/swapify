"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { acceptSwap, cancelSwap, confirmSwap, declineSwap, fundSwap, type ApiSwap } from "@/lib/api";

type Props = {
  swap: ApiSwap;
  accessToken: string;
  myUserId: string;
};

export default function SwapActions({ swap, accessToken, myUserId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const iAmRequestedUser = swap.requestedUserId === myUserId;
  const iAmPayer =
    (swap.gapPayer === "OFFERING_USER" && swap.offeringUserId === myUserId) ||
    (swap.gapPayer === "REQUESTING_USER" && swap.requestedUserId === myUserId);
  const iConfirmed = iAmRequestedUser ? swap.requestedUserConfirmedAt : swap.offeringUserConfirmedAt;
  const inMotion = Boolean(swap.offeringUserConfirmedAt || swap.requestedUserConfirmedAt);

  const act = async (fn: (token: string, id: string) => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn(accessToken, swap.id);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
      setBusy(false);
    }
  };

  return (
    <div>
      {swap.status === "REQUESTED" && iAmRequestedUser && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => act(acceptSwap)}
            className="rounded-btn bg-brand px-3 py-1.5 text-sm font-semibold text-white shadow-glow transition-all hover:brightness-110 disabled:opacity-50"
          >
            Accept
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => act(declineSwap)}
            className="rounded-btn border border-rose-500 px-3 py-1.5 text-sm font-semibold text-rose-300 hover:bg-rose-950 disabled:opacity-50"
          >
            Decline
          </button>
        </div>
      )}

      {swap.status === "REQUESTED" && (
        <button
          type="button"
          disabled={busy}
          onClick={() => act(cancelSwap)}
          className="mt-2 text-xs text-muted underline hover:text-foreground disabled:opacity-50"
        >
          Cancel this swap
        </button>
      )}

      {swap.status === "AGREED" && iAmPayer && (
        <button
          type="button"
          disabled={busy}
          onClick={() => act(fundSwap)}
          className="mt-3 w-full rounded-btn bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-all hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? "Holding..." : `Fund escrow (${Number(BigInt(swap.gapMicroTokens)) / 1_000_000} tokens)`}
        </button>
      )}

      {(swap.status === "AGREED" || swap.status === "ESCROWED") && (
        <>
          {!iConfirmed ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => act(confirmSwap)}
              className="mt-3 w-full rounded-btn border border-emerald-500 px-3 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-950 disabled:opacity-50"
            >
              Confirm I received my item
            </button>
          ) : (
            <p className="mt-3 text-xs text-emerald-400">You confirmed receipt. Waiting for the other party.</p>
          )}
          {!inMotion && (
            <button
              type="button"
              disabled={busy}
              onClick={() => act(cancelSwap)}
              className="mt-2 text-xs text-muted underline hover:text-foreground disabled:opacity-50"
            >
              Cancel this swap
            </button>
          )}
        </>
      )}

      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
    </div>
  );
}
