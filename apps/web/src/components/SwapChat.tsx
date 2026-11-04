"use client";

import { useEffect, useState } from "react";
import { SWAP_STATUS_LABELS } from "@swapify/shared";
import { fetchMessages, formatPence, sendMessage, type ApiItem, type ApiMessage, type ApiSwap } from "@/lib/api";
import ChatThread from "./ChatThread";
import ItemImage from "./ItemImage";

type Props = {
  swap: ApiSwap;
  accessToken: string;
  myUserId: string;
  active: boolean;
};

function MiniItem({ item, label }: { item: ApiItem; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="h-10 w-10 shrink-0 overflow-hidden rounded-btn border border-line bg-surface-2">
        {item.images[0] ? <ItemImage src={item.images[0].url} alt={item.title} /> : null}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] text-muted">{label}</p>
        <p className="truncate text-xs font-semibold text-navy">{item.title}</p>
      </div>
    </div>
  );
}

export default function SwapChat({ swap, accessToken, myUserId, active }: Props) {
  const swapId = swap.id;
  const [messages, setMessages] = useState<ApiMessage[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { messages } = await fetchMessages(accessToken, swapId);
        if (!cancelled) setMessages(messages);
      } catch {
        /* transient poll errors are fine */
      }
    };
    load();
    const timer = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [accessToken, swapId]);

  const send = async (body: string) => {
    const { message } = await sendMessage(accessToken, swapId, body);
    setMessages((m) => [...m, message]);
  };

  const gapBalanced = swap.gapPence === 0;
  const statusLabel = SWAP_STATUS_LABELS[swap.status as keyof typeof SWAP_STATUS_LABELS] ?? swap.status;

  const header = (
    <div className="glass sticky top-0 z-10 border-b border-line px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <MiniItem item={swap.offeringItem} label="Offered" />
        <span
          className={`shrink-0 rounded-pill border px-2.5 py-1 text-[11px] font-bold ${
            gapBalanced
              ? "border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "border-token/40 bg-token/10 text-token"
          }`}
        >
          {gapBalanced ? "Balanced" : `+ ${formatPence(swap.gapPence)} top-up`}
        </span>
        <MiniItem item={swap.requestedItem} label="Wanted" />
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-muted">
        <span>Trade summary</span>
        <span className="rounded-pill border border-line bg-surface-2 px-2 py-0.5 font-semibold text-foreground/80">
          {statusLabel}
        </span>
      </div>
    </div>
  );

  return (
    <div className="mt-6 overflow-hidden rounded-card border border-line bg-surface">
      <ChatThread
        messages={messages}
        myUserId={myUserId}
        active={active}
        onSend={send}
        header={header}
      />
    </div>
  );
}
