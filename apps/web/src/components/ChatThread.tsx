"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export type ChatMessageLike = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  sender?: { name?: string | null };
};

type Props = {
  messages: ChatMessageLike[];
  myUserId: string;
  /** False renders a read-only composer notice (e.g. chat closed). */
  active: boolean;
  onSend: (body: string) => Promise<void>;
  /** Optional sticky header above the message list (e.g. trade summary). */
  header?: ReactNode;
  /** Optional content below the composer (e.g. Propose Swap shortcut). */
  footer?: ReactNode;
  emptyText?: string;
  readOnlyText?: string;
};

/**
 * Shared chat presentation: message bubbles + keyboard-safe sticky composer.
 * Used by swap chat and pre-swap item inquiry chat. Handles virtual-keyboard
 * viewport resizes so the composer stays visible on iOS/Android.
 */
export default function ChatThread({
  messages,
  myUserId,
  active,
  onSend,
  header,
  footer,
  emptyText = "No messages yet. Say hello.",
  readOnlyText = "Chat is read-only after the swap ends.",
}: Props) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
      await onSend(body);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col">
      {header}

      <div className="max-h-[52dvh] space-y-3 overflow-y-auto px-4 py-4 sm:max-h-80">
        {messages.length === 0 && <p className="text-sm text-muted">{emptyText}</p>}
        {messages.map((msg) => {
          const mine = msg.senderId === myUserId;
          return (
            <div key={msg.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-btn px-3 py-2 text-sm ${
                  mine ? "bg-brand text-white" : "bg-surface-2 text-foreground/90"
                }`}
              >
                {!mine && msg.sender?.name && (
                  <p className="text-xs font-semibold text-primary-soft">{msg.sender.name}</p>
                )}
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
        <div
          ref={composerRef}
          className="sticky bottom-0 flex items-center gap-2 border-t border-line bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
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
            {sending ? "..." : "Send"}
          </button>
        </div>
      ) : (
        <p className="border-t border-line px-4 py-3 text-xs text-muted">{readOnlyText}</p>
      )}

      {footer}
      {error && <p className="px-4 pb-3 text-xs text-danger">{error}</p>}
    </div>
  );
}
