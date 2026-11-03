"use client";

import { useState } from "react";
import { useSession, signIn } from "next-auth/react";
import type { ApiItem } from "@/lib/api";
import SwapBuilder from "@/components/swap/SwapBuilder";
import { ArrowLeftRight } from "lucide-react";

export default function SwapRequestButton({
  targetItem,
  className = "mt-4 w-full",
}: {
  targetItem: ApiItem;
  className?: string;
}) {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);

  if (status === "loading") return null;

  if (!session?.accessToken) {
    return (
      <button
        type="button"
        onClick={() => signIn(undefined, { callbackUrl: window.location.pathname + window.location.search })}
        className={`${className} rounded-btn bg-brand px-4 py-3 font-semibold text-white shadow-glow transition-all hover:scale-[1.02] hover:brightness-110 active:scale-[0.98]`}
      >
        Sign in to request this swap
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${className} flex items-center justify-center gap-2 rounded-btn bg-brand px-4 py-3 font-semibold text-white shadow-glow transition-all hover:scale-[1.02] hover:brightness-110 active:scale-[0.98]`}
      >
        <ArrowLeftRight className="h-4.5 w-4.5" aria-hidden />
        Propose a swap
      </button>
      {open && <SwapBuilder targetItem={targetItem} onClose={() => setOpen(false)} />}
    </>
  );
}
