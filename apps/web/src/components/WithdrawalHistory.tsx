"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ApiWithdrawal,
  listWithdrawals,
  cancelWithdrawal,
  formatPence,
  WITHDRAWAL_STATUS_LABELS,
} from "@/lib/api";
import StatusPill from "@/components/StatusPill";

const STATUS_TONE: Record<string, "emerald" | "amber" | "sky" | "rose" | "muted"> = {
  PENDING: "sky",
  APPROVED: "amber",
  PROCESSING: "amber",
  COMPLETED: "emerald",
  FAILED: "rose",
  CANCELLED: "muted",
};

type Props = {
  accessToken: string;
};

export default function WithdrawalHistory({ accessToken }: Props) {
  const [withdrawals, setWithdrawals] = useState<ApiWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await listWithdrawals(accessToken, { cursor: nextCursor, limit: 10 });
      setWithdrawals((prev) => [...prev, ...result.withdrawals]);
      setNextCursor(result.nextCursor);
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }, [accessToken, nextCursor, loadingMore]);

  useEffect(() => {
    listWithdrawals(accessToken, { limit: 10 })
      .then((result) => {
        setWithdrawals(result.withdrawals);
        setNextCursor(result.nextCursor);
      })
      .catch(() => { /* ignore */ })
      .finally(() => {
        setLoading(false);
      });
  }, [accessToken]);

  const handleCancel = async (id: string) => {
    setCancellingId(id);
    try {
      await cancelWithdrawal(accessToken, id);
      setWithdrawals((prev) =>
        prev.map((w) => (w.id === id ? { ...w, status: "CANCELLED" } : w)),
      );
    } catch {
      // ignore
    } finally {
      setCancellingId(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-card border border-line bg-surface p-6">
        <h2 className="text-sm font-semibold text-foreground">Withdrawal history</h2>
        <p className="mt-2 text-xs text-muted">Loading...</p>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface p-6">
      <h2 className="text-sm font-semibold text-foreground">Withdrawal history</h2>

      {withdrawals.length === 0 ? (
        <p className="mt-2 text-xs text-muted">No withdrawals yet.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {withdrawals.map((w) => (
            <div
              key={w.id}
              className="flex items-center justify-between rounded-btn bg-surface-2 px-3 py-2.5 text-sm"
            >
              <div>
                <p className="font-medium text-foreground">{formatPence(w.amountPence)}</p>
                <p className="text-xs text-muted">
                  {new Date(w.createdAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill
                  label={WITHDRAWAL_STATUS_LABELS[w.status] ?? w.status}
                  tone={STATUS_TONE[w.status] ?? "muted"}
                />
                {w.status === "PENDING" && (
                  <button
                    onClick={() => handleCancel(w.id)}
                    disabled={cancellingId === w.id}
                    className="text-xs text-rose-400 hover:text-rose-300 disabled:opacity-50"
                  >
                    {cancellingId === w.id ? "Cancelling..." : "Cancel"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

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
  );
}
