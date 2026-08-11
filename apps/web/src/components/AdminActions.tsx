"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatPence, setItemStatus, type AdminUser, type ApiItem } from "@/lib/api";
import { ITEM_STATUS_LABELS } from "@swapify/shared";

type Props = { accessToken: string; users: AdminUser[]; items: ApiItem[] };

export default function AdminActions({ accessToken, users, items }: Props) {
  const router = useRouter();
  const [error, setError] = useState("");

  const changeStatus = async (itemId: string, status: string) => {
    setError("");
    try {
      await setItemStatus(accessToken, itemId, status);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update status");
    }
  };

  return (
    <div className="mt-10 flex flex-col gap-8">
      {error && <p className="text-sm text-rose-400">{error}</p>}

      <section>
        <h2 className="text-xl font-bold text-foreground">Users</h2>
        <div className="mt-3 overflow-hidden rounded-card border border-line">
          {users.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-4 py-3 last:border-b-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{u.name}</p>
                <p className="truncate text-xs text-muted">
                  {u.email} · {u._count.items} items · {u._count.swapsOffered + u._count.swapsRequested} swaps ·{" "}
                  {u._count.paymentsMade} payments · {u.admin ? `admin (${u.admin.role})` : "user"}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold text-foreground">Listings</h2>
        <div className="mt-3 overflow-hidden rounded-card border border-line">
          {items.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-4 py-3 last:border-b-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
                <p className="truncate text-xs text-muted">
                  {item.owner.name} · {formatPence(item.valuePence)} ·{" "}
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
                    className={`rounded-btn border px-3 py-1 text-xs font-semibold disabled:opacity-40 ${
                      item.status === s ? "border-line-strong text-foreground" : "border-line text-muted hover:bg-surface-2"
                    }`}
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
