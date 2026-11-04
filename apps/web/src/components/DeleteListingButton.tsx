"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteItem } from "@/lib/api";

/** Owner-only listing delete: confirm -> delete -> return to browse. */
export default function DeleteListingButton({
  accessToken,
  itemId,
  itemTitle,
  className = "",
}: {
  accessToken: string;
  itemId: string;
  itemTitle: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const remove = async () => {
    if (!window.confirm(`Delete "${itemTitle}"? This removes the listing from the marketplace.`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteItem(accessToken, itemId);
      router.push("/browse");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete this listing");
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className={`flex min-h-[44px] w-full items-center justify-center gap-2 rounded-btn border border-rose-500/50 bg-surface px-4 py-2.5 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50 dark:text-rose-300 dark:hover:bg-rose-950 ${className}`}
      >
        <Trash2 className="h-4 w-4" aria-hidden />
        {busy ? "Deleting…" : "Delete listing"}
      </button>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </>
  );
}
