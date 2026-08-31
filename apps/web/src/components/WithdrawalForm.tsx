"use client";

import { useState, useEffect } from "react";
import {
  ApiBalance,
  ApiConnectAccount,
  fetchBalance,
  getConnectAccount,
  createWithdrawal,
  formatPence,
} from "@/lib/api";

const MIN_WITHDRAWAL = 500;
const MAX_WITHDRAWAL = 500_000; // £5,000.00

type Props = {
  accessToken: string;
  onComplete?: () => void;
};

export default function WithdrawalForm({ accessToken, onComplete }: Props) {
  const [balance, setBalance] = useState<ApiBalance | null>(null);
  const [connectAccount, setConnectAccount] = useState<ApiConnectAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    Promise.allSettled([
      fetchBalance(accessToken),
      getConnectAccount(accessToken),
    ])
      .then(([b, ca]) => {
        if (b.status === "fulfilled") setBalance(b.value);
        if (ca.status === "fulfilled") setConnectAccount(ca.value);
      })
      .catch(() => { /* ignore */ })
      .finally(() => {
        setLoading(false);
      });
  }, [accessToken]);

  const availablePence = balance?.availableBalancePence ?? 0;
  const amountPence = Math.round(parseFloat(amount || "0") * 100);
  const isValid =
    amountPence >= MIN_WITHDRAWAL &&
    amountPence <= MAX_WITHDRAWAL &&
    amountPence <= availablePence;
  const canWithdraw =
    connectAccount?.status === "ACTIVE" && connectAccount?.payoutsEnabled === true;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;

    setSubmitting(true);
    setError(null);
    setSuccess(false);

    try {
      await createWithdrawal(accessToken, amountPence);
      setSuccess(true);
      setAmount("");
      onComplete?.();
    } catch (e) {
      // P2 #18: Parse API error codes for friendly messages
      const msg = e instanceof Error ? e.message : "Withdrawal failed. Please try again.";
      if (msg.includes("INSUFFICIENT_BALANCE")) {
        setError("Your available balance is insufficient for this withdrawal.");
      } else if (msg.includes("MAXIMUM_WITHDRAWAL")) {
        setError(`Maximum withdrawal is ${formatPence(MAX_WITHDRAWAL)}.`);
      } else if (msg.includes("MINIMUM_WITHDRAWAL")) {
        setError(`Minimum withdrawal is ${formatPence(MIN_WITHDRAWAL)}.`);
      } else if (msg.includes("WITHDRAWAL_LIMIT_EXCEEDED")) {
        setError("You have exceeded your withdrawal limit. Please try again later.");
      } else if (msg.includes("PAYOUTS_DISABLED")) {
        setError("Payouts are disabled for your account. Please contact support.");
      } else if (msg.includes("ACCOUNT_NOT_ACTIVE")) {
        setError("Your payout account needs additional verification.");
      } else if (msg.includes("rate limit") || msg.includes("429")) {
        setError("Too many requests. Please wait a moment and try again.");
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-card border border-line bg-surface p-6">
        <h2 className="text-sm font-semibold text-foreground">Withdraw</h2>
        <p className="mt-2 text-xs text-muted">Loading...</p>
      </div>
    );
  }

  if (!canWithdraw) {
    return (
      <div className="rounded-card border border-line bg-surface p-6">
        <h2 className="text-sm font-semibold text-foreground">Withdraw</h2>
        <p className="mt-2 text-xs text-muted">
          Complete your payout setup before withdrawing.
        </p>
      </div>
    );
  }

  if (availablePence < MIN_WITHDRAWAL) {
    return (
      <div className="rounded-card border border-line bg-surface p-6">
        <h2 className="text-sm font-semibold text-foreground">Withdraw</h2>
        <p className="mt-2 text-xs text-muted">
          Minimum withdrawal is {formatPence(MIN_WITHDRAWAL)}. Your available balance is {formatPence(availablePence)}.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface p-6">
      <h2 className="text-sm font-semibold text-foreground">Withdraw</h2>

      {success && (
        <div className="mt-3 rounded-btn border border-emerald-500/30 bg-emerald-950/50 px-3 py-2 text-xs text-emerald-300">
          Withdrawal requested successfully.
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-btn border border-rose-500/30 bg-rose-950/50 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        <div className="rounded-btn bg-surface-2 px-4 py-3">
          <p className="text-xs text-muted">Available</p>
          <p className="text-lg font-bold text-foreground">{formatPence(availablePence)}</p>
        </div>

        <div>
          <label htmlFor="withdrawal-amount" className="text-xs font-medium text-muted">
            Amount (£)
          </label>
          <input
            id="withdrawal-amount"
            type="number"
            step="0.01"
            min={(MIN_WITHDRAWAL / 100).toFixed(2)}
            max={(Math.min(availablePence, MAX_WITHDRAWAL) / 100).toFixed(2)}
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setError(null); setSuccess(false); }}
            placeholder="0.00"
            className="mt-1 w-full rounded-btn border border-line bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-muted/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {amountPence > 0 && (
          <div className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Fee</span>
              <span className="text-foreground">{formatPence(0)}</span>
            </div>
            <div className="flex justify-between border-t border-line pt-1.5">
              <span className="font-medium text-foreground">You&apos;ll receive</span>
              <span className="font-bold text-foreground">{formatPence(amountPence)}</span>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={!isValid || submitting}
          className="w-full rounded-btn bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-glow transition-all hover:brightness-110 hover:shadow-raise active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
        >
          {submitting ? "Requesting..." : "Request withdrawal"}
        </button>

        {amountPence > 0 && amountPence < MIN_WITHDRAWAL && (
          <p className="text-xs text-amber-400">
            Minimum withdrawal is {formatPence(MIN_WITHDRAWAL)}.
          </p>
        )}

        {amountPence > MAX_WITHDRAWAL && (
          <p className="text-xs text-amber-400">
            Maximum withdrawal is {formatPence(MAX_WITHDRAWAL)}.
          </p>
        )}

        {amountPence > availablePence && amountPence >= MIN_WITHDRAWAL && (
          <p className="text-xs text-amber-400">
            Amount exceeds available balance of {formatPence(availablePence)}.
          </p>
        )}
      </form>
    </div>
  );
}
