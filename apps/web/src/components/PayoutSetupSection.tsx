"use client";

import { useState, useEffect } from "react";
import {
  ApiConnectAccount,
  ApiPayoutMethod,
  getConnectAccount,
  startConnectOnboarding,
  syncConnectAccount,
  getPayoutMethods,
} from "@/lib/api";
import StatusPill from "@/components/StatusPill";
import { ExternalLink, RefreshCw, CheckCircle, AlertCircle } from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; tone: "emerald" | "amber" | "sky" | "rose" | "muted"; message: string }> = {
  NONE: { label: "Not set up", tone: "muted", message: "Set up your payout details to withdraw your balance." },
  ONBOARDING: { label: "In progress", tone: "amber", message: "Complete your payout setup." },
  ACTIVE: { label: "Ready", tone: "emerald", message: "Payouts are ready." },
  RESTRICTED: { label: "Restricted", tone: "amber", message: "Additional information is required." },
  DISABLED: { label: "Unavailable", tone: "rose", message: "Payouts are currently unavailable." },
};

type Props = {
  accessToken: string;
  onStatusChange?: () => void;
};

export default function PayoutSetupSection({ accessToken, onStatusChange }: Props) {
  const [account, setAccount] = useState<ApiConnectAccount | null>(null);
  const [methods, setMethods] = useState<ApiPayoutMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = () => {
    Promise.allSettled([
      getConnectAccount(accessToken),
      getPayoutMethods(accessToken),
    ])
      .then(([ca, pm]) => {
        if (ca.status === "fulfilled") setAccount(ca.value);
        if (pm.status === "fulfilled") setMethods(pm.value.payoutMethods);
      })
      .catch(() => {
        setError("Failed to load payout details.");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const handleStartOnboarding = async () => {
    setOnboarding(true);
    setError(null);
    try {
      const result = await startConnectOnboarding(accessToken);
      if (result.url) {
        window.location.href = result.url;
        return;
      }
      if (result.status === "ACTIVE") {
        loadAll();
        onStatusChange?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start payout setup.");
    } finally {
      setOnboarding(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await syncConnectAccount(accessToken);
      loadAll();
      onStatusChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-card border border-line bg-surface p-6">
        <h2 className="text-sm font-semibold text-foreground">Payout setup</h2>
        <p className="mt-2 text-xs text-muted">Loading...</p>
      </div>
    );
  }

  const status = account?.status ?? "NONE";
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.NONE;

  return (
    <div className="rounded-card border border-line bg-surface p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Payout setup</h2>
        <StatusPill label={config.label} tone={config.tone} />
      </div>

      <p className="mt-2 text-xs text-muted">{config.message}</p>

      {error && (
        <p className="mt-2 text-xs text-red-500">{error}</p>
      )}

      {status === "NONE" && (
        <button
          onClick={handleStartOnboarding}
          disabled={onboarding}
          className="mt-4 w-full rounded-btn bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-glow transition-all hover:brightness-110 hover:shadow-raise active:scale-[0.98] disabled:opacity-50"
        >
          {onboarding ? "Starting..." : "Set up payout details"}
        </button>
      )}

      {status === "ONBOARDING" && (
        <div className="mt-4 flex flex-col gap-2">
          <button
            onClick={handleStartOnboarding}
            disabled={onboarding}
            className="flex w-full items-center justify-center gap-2 rounded-btn bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-glow transition-all hover:brightness-110 hover:shadow-raise active:scale-[0.98] disabled:opacity-50"
          >
            <ExternalLink className="h-4 w-4" />
            {onboarding ? "Redirecting..." : "Continue payout setup"}
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex w-full items-center justify-center gap-2 rounded-btn border border-line bg-surface-2 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-3 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "I already completed setup"}
          </button>
        </div>
      )}

      {status === "ACTIVE" && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <CheckCircle className="h-4 w-4" />
            Payouts are ready
          </div>

          {methods.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted">Payout method</p>
              <div className="mt-1 flex flex-col gap-1.5">
                {methods.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between rounded-btn bg-surface-2 px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-foreground">
                        {m.bankName ?? "Bank account"} &bull;&bull;&bull;&bull;{m.last4 ?? "****"}
                      </span>
                      {m.isDefault && (
                        <span className="text-xs text-muted">(default)</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center justify-center gap-2 rounded-btn border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-3 hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      )}

      {status === "RESTRICTED" && (
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-amber-400">
            <AlertCircle className="h-4 w-4" />
            Additional information required
          </div>
          <button
            onClick={handleStartOnboarding}
            disabled={onboarding}
            className="flex w-full items-center justify-center gap-2 rounded-btn bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-glow transition-all hover:brightness-110 hover:shadow-raise active:scale-[0.98] disabled:opacity-50"
          >
            {onboarding ? "Redirecting..." : "Complete verification"}
          </button>
        </div>
      )}

      {status === "DISABLED" && (
        <div className="mt-3 flex items-center gap-2 text-xs text-rose-400">
          <AlertCircle className="h-4 w-4" />
          Payouts are currently unavailable. Please contact support.
        </div>
      )}
    </div>
  );
}
