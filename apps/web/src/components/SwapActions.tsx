"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { acceptSwap, cancelSwap, confirmSwap, declineSwap, formatPence, paySwap, type ApiSwap } from "@/lib/api";
import MobileActionBar from "./MobileActionBar";

type Props = {
  swap: ApiSwap;
  accessToken: string;
  myUserId: string;
  /** Renders a fixed mobile bottom action bar alongside the inline block. */
  sticky?: boolean;
};

export default function SwapActions({ swap, accessToken, myUserId, sticky = false }: Props) {
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

  const pay = async () => {
    setBusy(true);
    setError("");
    try {
      const { checkoutUrl } = await paySwap(accessToken, swap.id);
      window.location.href = checkoutUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start payment");
      setBusy(false);
    }
  };

  const acceptBtn = (
    <button
      type="button"
      disabled={busy}
      onClick={() => act(acceptSwap)}
      className="min-h-[44px] flex-1 rounded-btn bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-glow transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50 sm:flex-none"
    >
      Accept Trade
    </button>
  );
  const declineBtn = (
    <button
      type="button"
      disabled={busy}
      onClick={() => act(declineSwap)}
      className="min-h-[44px] flex-1 rounded-btn border border-rose-500 px-4 py-2.5 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50 sm:flex-none dark:text-rose-300 dark:hover:bg-rose-950"
    >
      Decline
    </button>
  );
  const payBtn = (
    <button
      type="button"
      disabled={busy}
      onClick={pay}
      className="min-h-[44px] w-full rounded-btn bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-emerald-500 active:scale-[0.99] disabled:opacity-50"
    >
      {busy ? "Opening checkout..." : `Pay ${formatPence(swap.gapPence + (swap.payment?.feePence ?? 0))}`}
    </button>
  );
  const confirmBtn = (
    <button
      type="button"
      disabled={busy}
      onClick={() => act(confirmSwap)}
      className="min-h-[44px] w-full rounded-btn border border-emerald-500 px-4 py-2.5 text-sm font-semibold text-emerald-600 transition-colors hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-950"
    >
      Confirm I received my item
    </button>
  );
  const cancelLink = (
    <button
      type="button"
      disabled={busy}
      onClick={() => act(cancelSwap)}
      className="min-h-[44px] px-2 text-xs text-muted underline hover:text-foreground disabled:opacity-50"
    >
      Cancel this swap
    </button>
  );

  // Primary action for the mobile bottom bar (one per state).
  const barPrimary =
    swap.status === "REQUESTED" && iAmRequestedUser
      ? [declineBtn, acceptBtn]
      : swap.status === "AGREED" && iAmPayer && swap.gapPence > 0
        ? [payBtn]
        : (swap.status === "AGREED" || swap.status === "PAID") && !iConfirmed
          ? [confirmBtn]
          : null;

  return (
    <div>
      {swap.status === "REQUESTED" && iAmRequestedUser && (
        <div className="mt-3 flex gap-2">
          {acceptBtn}
          {declineBtn}
        </div>
      )}

      {swap.status === "REQUESTED" && <div className="mt-2">{cancelLink}</div>}

      {swap.status === "AGREED" && iAmPayer && swap.gapPence > 0 && (
        <>
          <p className="mt-3 text-xs text-muted">
            You pay <span className="font-semibold text-token">{formatPence(swap.gapPence)}</span> value difference
            {swap.payment && swap.payment.feePence > 0 && (
              <> + <span className="font-semibold text-token">{formatPence(swap.payment.feePence)}</span> Swapify fee</>
            )}
          </p>
          <div className="mt-2">{payBtn}</div>
        </>
      )}

      {(swap.status === "AGREED" || swap.status === "PAID") && (
        <>
          {!iConfirmed ? (
            <div className="mt-3">{confirmBtn}</div>
          ) : (
            <p className="mt-3 text-xs text-emerald-600 dark:text-emerald-400">
              You confirmed receipt. Waiting for the other party.
            </p>
          )}
          {!inMotion && <div className="mt-2">{cancelLink}</div>}
        </>
      )}

      {swap.status === "PAID" && iAmPayer && (
        <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
          Payment received — value gap held until both items are delivered.
        </p>
      )}
      {swap.status === "PAID" && !iAmPayer && swap.gapPence > 0 && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          Value difference: {formatPence(swap.gapPence)} — held until both items are delivered.
        </p>
      )}

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      {sticky && barPrimary && (
        <MobileActionBar>
          {barPrimary}
          {error && <span className="sr-only">{error}</span>}
        </MobileActionBar>
      )}
    </div>
  );
}
