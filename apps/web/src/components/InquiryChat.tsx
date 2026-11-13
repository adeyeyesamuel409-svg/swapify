"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeftRight, MessageCircleQuestion, X } from "lucide-react";
import {
  fetchInquiryMessages,
  openInquiry,
  sendInquiryMessage,
  type ApiInquiryMessage,
  type ApiItem,
} from "@/lib/api";
import ChatThread from "./ChatThread";
import ItemImage from "./ItemImage";
import SwapBuilder from "./swap/SwapBuilder";

/**
 * Pre-swap question thread for a listing: lets a buyer chat with the seller
 * about the item before proposing a swap. Includes a Propose Swap shortcut.
 */
export default function InquiryChat({
  item,
  accessToken,
  myUserId,
  onClose,
}: {
  item: ApiItem;
  accessToken: string;
  myUserId: string;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();
  const [inquiryId, setInquiryId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ApiInquiryMessage[]>([]);
  const [loadError, setLoadError] = useState("");
  const [builderOpen, setBuilderOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { inquiry } = await openInquiry(accessToken, item.id);
        if (cancelled) return;
        setInquiryId(inquiry.id);
        const { messages } = await fetchInquiryMessages(accessToken, inquiry.id);
        if (!cancelled) setMessages(messages);
      } catch {
        if (!cancelled) setLoadError("Could not open the conversation.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, item.id]);

  useEffect(() => {
    if (!inquiryId) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const { messages } = await fetchInquiryMessages(accessToken, inquiryId);
        if (!cancelled) setMessages(messages);
      } catch {
        /* poll errors are transient */
      }
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [accessToken, inquiryId]);

  const send = async (body: string) => {
    if (!inquiryId) return;
    const { message } = await sendInquiryMessage(accessToken, inquiryId, body);
    setMessages((m) => [...m, message]);
  };

  const header = (
    <div className="glass sticky top-0 z-10 flex items-center gap-3 border-b border-line px-4 py-3">
      <span className="h-11 w-11 shrink-0 overflow-hidden rounded-btn border border-line bg-surface-2">
        {item.images[0] ? <ItemImage src={item.images[0].url} alt={item.title} /> : null}
      </span>
      <div className="min-w-0 flex-1">
        <p className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary-soft">
          <MessageCircleQuestion className="h-3 w-3" aria-hidden />
          Question about this item
        </p>
        <p className="truncate text-sm font-semibold text-navy">{item.title}</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close conversation"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill border border-line text-muted transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );

  const footer = (
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
  );

  return (
    <>
      <AnimatePresence>
        <motion.div
          key="inquiry-overlay"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={`Conversation about ${item.title}`}
        >
          <motion.div
            className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-card border border-line bg-surface shadow-raise sm:rounded-card"
            initial={reduce ? false : { opacity: 0, y: 32, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 240, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
          >
            {loadError ? (
              <div className="p-8 text-center">
                <p className="text-sm text-danger">{loadError}</p>
                <button
                  type="button"
                  onClick={onClose}
                  className="mt-4 min-h-[44px] rounded-btn border border-line px-5 py-2.5 text-sm font-semibold text-foreground"
                >
                  Close
                </button>
              </div>
            ) : (
              <ChatThread
                messages={messages}
                myUserId={myUserId}
                active
                onSend={send}
                header={header}
                footer={footer}
                emptyText="Ask about condition, collection, or anything else. Sellers usually reply quickly."
              />
            )}
          </motion.div>
        </motion.div>
      </AnimatePresence>

      {builderOpen && <SwapBuilder targetItem={item} onClose={() => setBuilderOpen(false)} />}
    </>
  );
}
