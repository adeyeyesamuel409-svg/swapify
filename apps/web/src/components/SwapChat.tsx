"use client";

import { useEffect, useRef, useState } from "react";
import { fetchMessages, sendMessage, type ApiMessage } from "@/lib/api";

type Props = {
  swapId: string;
  accessToken: string;
  myUserId: string;
  active: boolean;
};

export default function SwapChat({ swapId, accessToken, myUserId, active }: Props) {
  const [messages, setMessages] = useState<ApiMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="mt-6 overflow-hidden rounded-card border border-line bg-surface">
      <p className="border-b border-line px-4 py-3 text-sm font-semibold text-foreground">Chat</p>

      <div className="max-h-80 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && <p className="text-sm text-muted">No messages yet - say hello.</p>}
        {messages.map((msg) => {
          const mine = msg.senderId === myUserId;
          return (
            <div key={msg.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-btn px-3 py-2 text-sm ${mine ? "bg-brand text-white" : "bg-surface-2 text-foreground/90"}`}>
                {!mine && <p className="text-xs font-semibold text-primary-soft">{msg.sender.name}</p>}
                <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                <p className="mt-1 text-right text-[10px] text-muted">
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {active ? (
        <div className="flex gap-2 border-t border-line p-3">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Type a message..."
            className="h-10 flex-1 rounded-btn border border-line bg-surface-2 px-3 text-sm text-foreground placeholder:text-muted focus:border-primary/60 focus:outline-none"
          />
          <button
            type="button"
            disabled={sending || !text.trim()}
            onClick={submit}
            className="rounded-btn bg-brand px-4 text-sm font-semibold text-white shadow-glow transition-all hover:brightness-110 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      ) : (
        <p className="border-t border-line px-4 py-3 text-xs text-muted">
          Chat is read-only after the swap ends.
        </p>
      )}

      {error && <p className="px-4 pb-3 text-xs text-rose-400">{error}</p>}
    </div>
  );
}
