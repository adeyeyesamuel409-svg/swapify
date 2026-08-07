"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { fetchUnreadCount } from "@/lib/api";

export default function NotificationBell() {
  const { data: session } = useSession();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!session?.accessToken) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { count } = await fetchUnreadCount(session.accessToken!);
        if (!cancelled) setCount(count);
      } catch {
        // keep last known count on failure
      }
    };
    load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [session?.accessToken]);

  if (!session?.user) return null;

  return (
    <Link
      href="/notifications"
      className="relative rounded-md border border-gray-600 px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-700"
      aria-label="Notifications"
    >
      <span aria-hidden>🔔</span>
      {count > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
