"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Bell } from "lucide-react";
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
      className="relative flex h-9 w-9 items-center justify-center rounded-btn border border-line bg-surface-2 text-muted transition-colors hover:border-primary/60 hover:text-foreground"
      aria-label="Notifications"
    >
      <Bell className="h-4 w-4" aria-hidden />
      {count > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-pill bg-rose-500 px-1 text-[10px] font-bold text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
