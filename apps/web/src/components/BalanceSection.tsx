"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ApiBalance,
  ApiBalanceEntry,
  ApiConnectAccount,
  fetchBalance,
  fetchBalanceTransactions,
  formatPence,
  getConnectAccount,
} from "@/lib/api";

const ENTRY_TYPE_LABELS: Record<string, string> = {
  VALUE_GAP_CREDIT: "Value-gap settlement",
  WITHDRAWAL_DEBIT: "Withdrawal",
  WITHDRAWAL_REVERSAL: "Withdrawal reversed",
  ADMIN_ADJUSTMENT: "Admin adjustment",
};

type Props = {
  accessToken: string;
  onNavigateToWithdraw?: () => void;
};

export default function BalanceSection({ accessToken, onNavigateToWithdraw }: Props) {
  const [balance, setBalance] = useState<ApiBalance | null>(null);
  const [entries, setEntries] = useState<ApiBalanceEntry[]>([]);
  const [connectAccount, setConnectAccount] = useState<ApiConnectAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const txs = await fetchBalanceTransactions(accessToken, {
        cursor: nextCursor,
        limit: 10,
      });
      setEntries((prev) => [...prev, ...txs.entries]);
      setNextCursor(txs.nextCursor);
    } catch {
      setError("Failed to load more transactions.");
    } finally {
      setLoadingMore(false);
    }
  }, [accessToken, nextCursor, loadingMore]);

  useEffect(() => {
    Promise.allSettled([
      fetchBalance(accessToken),
      fetchBalanceTransactions(accessToken, { limit: 10 }),
      getConnectAccount(accessToken),
    ])
      .then(([b, txs, ca]) => {
        if (b.status === "fulfilled") setBalance(b.value);
        if (txs.status === "fulfilled") {
          setEntries(txs.value.entries);
          setNextCursor(txs.value.nextCursor);
        }
        if (ca.status === "fulfilled") setConnectAccount(ca.value);
      })
      .catch(() => {
        setError("Unable to load balance. Please try again.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [accessToken]);

  if (loading) {
    return (
      <div className="rounded-card border border-line bg-surface p-6">
        <h2 className="text-sm font-semibold text-foreground">Swapify Balance</h2>
        <p className="mt-2 text-xs text-muted">Loading...</p>
      </div>
    );
  }

  // P2 #13: If balance failed to load, show error state instead of £0.00.
  if (error && !balance) {
    return (
      <div className="rounded-card border border-line bg-surface p-6">
        <h2 className="text-sm font-semibold text-foreground">Swapify Balance</h2>
        <p className="mt-2 text-xs text-red-500">Unable to load balance. Please try again.</p>
        <button
          onClick={() => {
            setError(null);
            setLoading(true);
            Promise.allSettled([
              fetchBalance(accessToken),
              fetchBalanceTransactions(accessToken, { limit: 10 }),
              getConnectAccount(accessToken),
            ])
              .then(([b, txs, ca]) => {
                if (b.status === "fulfilled") setBalance(b.value);
                if (txs.status === "fulfilled") {
                  setEntries(txs.value.entries);
                  setNextCursor(txs.value.nextCursor);
                }
                if (ca.status === "fulfilled") setConnectAccount(ca.value);
              })
              .catch(() => {
                setError("Unable to load balance. Please try again.");
              })
              .finally(() => {
                setLoading(false);
              });
          }}
          className="mt-2 rounded-btn border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-3"
        >
          Retry
        </button>
      </div>
    );
  }

  const canWithdraw =
    connectAccount?.status === "ACTIVE" &&
    connectAccount?.payoutsEnabled === true &&
    (balance?.availableBalancePence ?? 0) >= 500;

  return (
    <div className="rounded-card border border-line bg-surface p-6">
      <h2 className="text-sm font-semibold text-foreground">Swapify Balance</h2>

      {error && (
        <p className="mt-2 text-xs text-red-500">{error}</p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-muted">Pending</p>
          <p className="text-2xl font-bold text-foreground">
            {formatPence(balance?.pendingBalancePence ?? 0)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">Available</p>
          <p className="text-2xl font-bold text-foreground">
            {formatPence(balance?.availableBalancePence ?? 0)}
          </p>
        </div>
      </div>

      {canWithdraw && onNavigateToWithdraw && (
        <button
          onClick={onNavigateToWithdraw}
          className="mt-4 w-full rounded-btn bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-glow transition-all hover:brightness-110 hover:shadow-raise active:scale-[0.98]"
        >
          Withdraw
        </button>
      )}

      {!canWithdraw && connectAccount?.status !== "ACTIVE" && connectAccount?.connected && (
        <p className="mt-3 text-xs text-muted">
          Complete your payout setup to withdraw your balance.
        </p>
      )}

      {!connectAccount?.connected && (balance?.availableBalancePence ?? 0) > 0 && (
        <p className="mt-3 text-xs text-muted">
          Set up payouts to withdraw your balance.
        </p>
      )}

      {(balance?.availableBalancePence ?? 0) === 0 && (balance?.pendingBalancePence ?? 0) === 0 && (
        <p className="mt-3 text-xs text-muted">
          No balance yet. Complete a value-gap swap to earn credit.
        </p>
      )}

      {entries.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold text-foreground">Transaction history</h3>
          <div className="mt-2 flex flex-col gap-2">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between rounded-btn bg-surface-2 px-3 py-2 text-sm"
              >
                <div>
                  <p className="text-foreground">
                    {entry.direction === "CREDIT" ? "+" : "-"}
                    {formatPence(entry.amountPence)}
                  </p>
                  <p className="text-xs text-muted">
                    {ENTRY_TYPE_LABELS[entry.type] ?? entry.type}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted">
                    {new Date(entry.createdAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                  {entry.referenceType === "VALUE_GAP" && (
                    <p className="text-xs text-muted">
                      Swap #{entry.referenceId.slice(-6).toUpperCase()}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {nextCursor && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-3 w-full rounded-btn border border-line bg-surface-2 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-3 disabled:opacity-50"
            >
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
