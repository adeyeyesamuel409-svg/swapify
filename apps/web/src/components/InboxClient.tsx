"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowLeftRight, MessageCircleQuestion, Store } from "lucide-react";
import {
  fetchInquiryMessages,
  fetchItem,
  sendInquiryMessage,
  type ApiInquiryMessage,
  type ApiInquiryThread,
  type ApiItem,
} from "@/lib/api";
import ChatThread from "./ChatThread";
import ItemImage from "./ItemImage";
import SwapBuilder from "./swap/SwapBuilder";

export default function InboxClient({
  threads,
  accessToken,
  myUserId,
}: {
  threads: ApiInquiryThread[];
  accessToken: string;
  myUserId: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [item, setItem] = useState<ApiItem | null>(null);
  const [messages, setMessages] = useState<ApiInquiryMessage[]>([]);
  const [builderOpen, setBuilderOpen] = useState(false);

  const selected = threads.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ messages }, { item }] = await Promise.all([
          fetchInquiryMessages(accessToken, selectedId),
          fetchItem(threads.find((t) => t.id === selectedId)?.itemId ?? ""),
        ]);
        if (cancelled) return;
        setMessages(messages);
        setItem(item);
      } catch {
        /* keep prior state on failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, selectedId, threads]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const { messages } = await fetchInquiryMessages(accessToken, selectedId);
        if (!cancelled) setMessages(messages);
      } catch {
        /* transient */
      }
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [accessToken, selectedId]);

  const send = async (body: string) => {
    if (!selectedId) return;
    const { message } = await sendInquiryMessage(accessToken, selectedId, body);
    setMessages((m) => [...m, message]);
  };

  if (threads.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-line bg-surface px-6 py-14 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-pill bg-primary/10 text-primary-soft">
          <MessageCircleQuestion className="h-7 w-7" aria-hidden />
        </span>
        <h2 className="mt-4 text-xl font-bold text-navy">No questions yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          When you ask a seller about an item, or someone asks you, the conversation shows up here.
        </p>
        <Link
          href="/browse"
          className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-btn bg-brand px-5 py-2.5 font-semibold text-white shadow-glow transition-all hover:scale-[1.02] hover:brightness-110 active:scale-[0.98]"
        >
          Explore Swaps Near You
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
      {/* thread list */}
      <div className={`${selectedId ? "hidden lg:block" : "block"} overflow-hidden rounded-card border border-line bg-surface`}>
        <p className="border-b border-line px-4 py-3 text-sm font-semibold text-navy">Conversations</p>
        <ul className="max-h-[65dvh] divide-y divide-line overflow-y-auto">
          {threads.map((t) => {
            const counterpartyName = t.iAmBuyer ? t.counterparty.name ?? "Seller" : t.buyer.name;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 ${
                    selectedId === t.id ? "bg-surface-2" : ""
                  }`}
                >
                  <span className="h-11 w-11 shrink-0 overflow-hidden rounded-btn border border-line bg-surface-2">
                    {t.itemImage ? (
                      <ItemImage src={t.itemImage} alt={t.itemTitle} />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-muted">
                        <Store className="h-4 w-4" aria-hidden />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-navy">{t.itemTitle}</span>
                      {t.unread && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {counterpartyName}: {t.lastMessage?.body ?? "No messages yet"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* thread panel */}
      <div className={`${selectedId ? "block" : "hidden lg:block"} overflow-hidden rounded-card border border-line bg-surface`}>
        {selected ? (
          <ChatThread
            messages={messages}
            myUserId={myUserId}
            active
            onSend={send}
            header={
              <div className="glass sticky top-0 z-10 flex items-center gap-3 border-b border-line px-4 py-3">
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  aria-label="Back to conversations"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill border border-line text-muted transition-colors hover:border-primary/40 hover:text-foreground lg:hidden"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary-soft">
                    <MessageCircleQuestion className="h-3 w-3" aria-hidden />
                    Question about this item
                  </p>
                  <Link href={`/items/${selected.itemId}`} className="truncate text-sm font-semibold text-navy hover:underline">
                    {selected.itemTitle}
                  </Link>
                </div>
              </div>
            }
            footer={
              item ? (
                <div className="border-t border-line bg-surface-2/60 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setBuilderOpen(true)}
                    className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-btn bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-glow transition-all hover:scale-[1.01] hover:brightness-110 active:scale-[0.99]"
                  >
                    <ArrowLeftRight className="h-4 w-4" aria-hidden />
                    Propose a swap for this item
                  </button>
                </div>
              ) : null
            }
            emptyText="Ask about condition, collection, or anything else. Sellers usually reply quickly."
          />
        ) : (
          <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 p-10 text-center">
            <MessageCircleQuestion className="h-8 w-8 text-muted opacity-60" aria-hidden />
            <p className="text-sm text-muted">Select a conversation to start chatting.</p>
          </div>
        )}
      </div>

      {builderOpen && item && <SwapBuilder targetItem={item} onClose={() => setBuilderOpen(false)} />}
    </div>
  );
}

