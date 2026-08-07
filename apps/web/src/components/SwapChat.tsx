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
    <div className="mt-6 rounded-xl border border-gray-700 bg-gray-800">
      <p className="border-b border-gray-700 px-4 py-3 text-sm font-semibold text-white">Chat</p>

      <div className="max-h-80 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && <p className="text-sm text-gray-500">No messages yet - say hello.</p>}
        {messages.map((msg) => {
          const mine = msg.senderId === myUserId;
          return (
            <div key={msg.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${mine ? "bg-indigo-700 text-white" : "bg-gray-700 text-gray-100"}`}>
                {!mine && <p className="text-xs font-semibold text-indigo-300">{msg.sender.name}</p>}
                <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                <p className="mt-1 text-right text-[10px] text-gray-400">
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {active ? (
        <div className="flex gap-2 border-t border-gray-700 p-3">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Type a message..."
            className="flex-1 rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white placeholder:text-gray-500"
          />
          <button
            type="button"
            disabled={sending || !text.trim()}
            onClick={submit}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      ) : (
        <p className="border-t border-gray-700 px-4 py-3 text-xs text-gray-500">
          Chat is read-only after the swap ends.
        </p>
      )}

      {error && <p className="px-4 pb-3 text-xs text-red-400">{error}</p>}
    </div>
  );
}
