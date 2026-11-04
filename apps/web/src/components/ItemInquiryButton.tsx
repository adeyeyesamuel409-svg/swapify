"use client";

import { useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { MessageCircleQuestion } from "lucide-react";
import type { ApiItem } from "@/lib/api";
import InquiryChat from "./InquiryChat";

/** "Ask a question" trigger for a listing — opens the pre-swap inquiry chat. */
export default function ItemInquiryButton({
  targetItem,
  className = "mt-2 w-full",
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
        className={`${className} flex items-center justify-center gap-2 rounded-btn border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-navy transition-colors hover:border-primary/50 hover:text-primary-soft`}
      >
        <MessageCircleQuestion className="h-4 w-4" aria-hidden />
        Ask a question
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${className} flex items-center justify-center gap-2 rounded-btn border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-navy transition-colors hover:border-primary/50 hover:text-primary-soft`}
      >
        <MessageCircleQuestion className="h-4 w-4" aria-hidden />
        Ask a question
      </button>
      {open && (
        <InquiryChat
          item={targetItem}
          accessToken={session.accessToken}
          myUserId={(session.user as { id?: string })?.id ?? ""}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
