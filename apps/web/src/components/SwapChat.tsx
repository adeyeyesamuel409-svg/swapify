"use client";

import { useEffect, useRef, useState } from "react";
import { SWAP_STATUS_LABELS } from "@swapify/shared";
import { fetchMessages, formatPence, sendMessage, type ApiItem, type ApiMessage, type ApiSwap } from "@/lib/api";
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
        {item.images[0] ? (
          <ItemImage src={item.images[0].url} alt={item.title} />
        ) : null}
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
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { messages } = await fetchMessages(accessToken, swapId);
        if (!cancelled) setMessages(messages);
      } catch {
        if (!cancelled) setError("Could not load messages");
      }
    };
    load();
    const timer = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [accessToken, swapId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Keyboard handling (iOS/Android): when the virtual keyboard resizes the
  // visual viewport, keep the composer and latest message in view.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      bottomRef.current?.scrollIntoView({ block: "end" });
      composerRef.current?.scrollIntoView({ block: "nearest" });
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  const submit = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    try {
      const { message } = await sendMessage(accessToken, swapId, body);
      setMessages((m) => [...m, message]);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const gapBalanced = swap.gapPence === 0;
  const statusLabel = SWAP_STATUS_LABELS[swap.status as keyof typeof SWAP_STATUS_LABELS] ?? swap.status;

  return (
    <div className="mt-6 flex flex-col overflow-hidden rounded-card border border-line bg-surface">
      {/* sticky trade summary */}
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

      {/* message history */}
      <div className="max-h-[58dvh] space-y-3 overflow-y-auto px-4 py-4 sm:max-h-80">
        {messages.length === 0 && <p className="text-sm text-muted">No messages yet — say hello.</p>}
        {messages.map((msg) => {
          const mine = msg.senderId === myUserId;
          return (
            <div key={msg.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-btn px-3 py-2 text-sm ${mine ? "bg-brand text-white" : "bg-surface-2 text-foreground/90"}`}>
                {!mine && <p className="text-xs font-semibold text-primary-soft">{msg.sender.name}</p>}
                <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                <p className={`mt-1 text-right text-[10px] ${mine ? "text-white/70" : "text-muted"}`}>
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {active ? (
        <div ref={composerRef} className="sticky bottom-0 flex items-center gap-2 border-t border-line bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => {
              setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 300);
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Type a message..."
            className="h-11 min-w-0 flex-1 rounded-btn border border-line bg-surface-2 px-3 text-base text-foreground placeholder:text-muted focus:border-primary/60 focus:outline-none"
          />
          <button
            type="button"
            disabled={sending || !text.trim()}
            onClick={submit}
            className="min-h-[44px] rounded-btn bg-brand px-5 text-sm font-semibold text-white shadow-glow transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          >
            Send
          </button>
        </div>
      ) : (
        <p className="border-t border-line px-4 py-3 text-xs text-muted">
          Chat is read-only after the swap ends.
        </p>
      )}

      {error && <p className="px-4 pb-3 text-xs text-danger">{error}</p>}
    </div>
  );
}
