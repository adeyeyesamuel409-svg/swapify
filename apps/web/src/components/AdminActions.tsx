"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { creditUserTokens, setItemStatus, type AdminUser, type ApiItem } from "@/lib/api";
import { ITEM_STATUS_LABELS } from "@swapify/shared";

type Props = { accessToken: string; users: AdminUser[]; items: ApiItem[] };

export default function AdminActions({ accessToken, users, items }: Props) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [credit, setCredit] = useState<{ userId: string; tokens: string } | null>(null);

  const changeStatus = async (itemId: string, status: string) => {
    setError("");
    try {
      await setItemStatus(accessToken, itemId, status);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update status");
    }
  };

  const doCredit = async () => {
    if (!credit) return;
    setError("");
    try {
      await creditUserTokens(accessToken, credit.userId, { tokens: Number(credit.tokens), note: "Admin adjustment" });
      setCredit(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to credit tokens");
    }
  };

  return (
    <div className="mt-10 flex flex-col gap-8">
      {error && <p className="text-sm text-red-400">{error}</p>}

      <section>
        <h2 className="text-xl font-bold text-white">Users</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-gray-700">
          {users.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-700 bg-gray-800 px-4 py-3 last:border-b-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{u.name}</p>
                <p className="truncate text-xs text-gray-500">
                  {u.email} · {Number(u.wallet?.balanceMicroTokens ?? "0") / 1_000_000} tokens ·{" "}
                  {u._count.items} items · {u._count.swapsOffered + u._count.swapsRequested} swaps ·{" "}
                  {u.admin ? `admin (${u.admin.role})` : "user"}
                </p>
              </div>
              {credit?.userId === u.id ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={credit.tokens}
                    onChange={(e) => setCredit({ userId: u.id, tokens: e.target.value })}
                    placeholder="tokens"
                    className="w-24 rounded-md border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-white"
                  />
                  <button type="button" onClick={doCredit} className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500">
                    Confirm
                  </button>
                  <button type="button" onClick={() => setCredit(null)} className="text-xs text-gray-400 hover:text-gray-200">
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCredit({ userId: u.id, tokens: "" })}
                  className="rounded-md border border-emerald-600 px-3 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-950"
                >
                  Credit tokens
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Listings</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-gray-700">
          {items.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-700 bg-gray-800 px-4 py-3 last:border-b-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{item.title}</p>
                <p className="truncate text-xs text-gray-500">
                  {item.owner.name} · {Number(BigInt(item.valueMicroTokens)) / 1_000_000} tokens ·{" "}
                  {ITEM_STATUS_LABELS[item.status] ?? item.status}
                </p>
              </div>
              <div className="flex gap-2">
                {(["ACTIVE", "HIDDEN", "DELETED"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={item.status === s}
                    onClick={() => changeStatus(item.id, s)}
                    className={`rounded-md border px-3 py-1 text-xs font-semibold disabled:opacity-40 ${item.status === s ? "border-gray-500 text-gray-300" : "border-gray-600 text-gray-300 hover:bg-gray-700"}`}
                  >
                    {ITEM_STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
