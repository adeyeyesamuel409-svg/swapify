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
    <main className="mx-auto max-w-2xl flex-1 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Notifications</h1>
        {unread > 0 && (
          <button type="button" onClick={markAll} className="text-sm text-indigo-400 underline hover:text-indigo-300">
            Mark all as read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <p className="mt-10 text-center text-gray-500">No notifications yet.</p>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {notifications.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => markRead(n)}
              className={`flex items-start justify-between gap-3 rounded-xl border p-4 text-left ${n.read ? "border-gray-700 bg-gray-800" : "border-indigo-500/40 bg-indigo-950"}`}
            >
              <div>
                <p className={`text-sm ${n.read ? "text-gray-300" : "text-white"}`}>{n.body}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {NOTIFICATION_TYPE_LABELS[n.type] ?? n.type} · {new Date(n.createdAt).toLocaleString()}
                </p>
              </div>
              {!n.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-indigo-400" />}
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
