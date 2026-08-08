"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type ApiNotification,
} from "@/lib/api";
import { NOTIFICATION_TYPE_LABELS } from "@swapify/shared";

type Props = { initial: ApiNotification[]; accessToken: string };

export default function NotificationsClient({ initial, accessToken }: Props) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<ApiNotification[]>(initial);

  useEffect(() => {
    fetchNotifications(accessToken)
      .then(({ notifications }) => setNotifications(notifications))
      .catch(() => {});
  }, [accessToken]);

  const markRead = async (n: ApiNotification) => {
    if (n.read) return;
    setNotifications((ns) => ns.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    await markNotificationRead(accessToken, n.id).catch(() => {});
    if (n.referenceId) {
      router.push(`/swaps/${n.referenceId}`);
    }
  };

  const markAll = async () => {
    await markAllNotificationsRead(accessToken).catch(() => {});
    setNotifications((ns) => ns.map((x) => ({ ...x, read: true })));
  };

  const unread = notifications.filter((n) => !n.read).length;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Notifications</h1>
        {unread > 0 && (
          <button type="button" onClick={markAll} className="text-sm font-semibold text-primary-soft underline hover:text-foreground">
            Mark all as read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <p className="mt-10 text-center text-muted">No notifications yet.</p>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {notifications.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => markRead(n)}
              className={`flex items-start justify-between gap-3 rounded-card border p-4 text-left transition-all duration-200 ${
                n.read ? "border-line bg-surface hover:border-line-strong" : "border-primary/40 bg-primary/10 hover:border-primary"
              }`}
            >
              <div>
                <p className={`text-sm ${n.read ? "text-muted" : "text-foreground"}`}>{n.body}</p>
                <p className="mt-1 text-xs text-muted">
                  {NOTIFICATION_TYPE_LABELS[n.type] ?? n.type} · {new Date(n.createdAt).toLocaleString()}
                </p>
              </div>
              {!n.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary-soft" />}
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
