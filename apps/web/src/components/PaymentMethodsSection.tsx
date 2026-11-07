"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, Plus, Star, Trash2 } from "lucide-react";
import {
  createCardSetupSession,
  fetchPaymentMethods,
  removePaymentMethod,
  setDefaultPaymentMethod,
  type ApiSavedCard,
} from "@/lib/api";
import StatusPill from "./StatusPill";

/**
 * Saved payment cards (the "Pay with" half of the Payments hub). Cards are
 * entered on Stripe's hosted page and stored by Stripe; Swapify only keeps the
 * customer reference and the display metadata.
 */
export default function PaymentMethodsSection({ accessToken }: { accessToken: string }) {
  const [cards, setCards] = useState<ApiSavedCard[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchPaymentMethods(accessToken)
      .then(({ cards }) => setCards(cards))
      .catch(() => setCards([]));
  }, [accessToken]);

  useEffect(load, [load]);

  const addCard = async () => {
    setAdding(true);
    setError(null);
    try {
      const { url } = await createCardSetupSession(accessToken);
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the card form");
      setAdding(false);
    }
  };

  const setDefault = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await setDefaultPaymentMethod(accessToken, id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update your default card");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (card: ApiSavedCard) => {
    if (!window.confirm(`Remove the ${card.brand} card ending ${card.last4}?`)) return;
    setBusyId(card.id);
    setError(null);
    try {
      await removePaymentMethod(accessToken, card.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove this card");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-card border border-line bg-surface p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Pay with</h2>
          <p className="mt-1 text-xs text-muted">
            Cards are used for cash top-ups when you swap. Details are handled by Stripe.
          </p>
        </div>
        <button
          type="button"
          onClick={addCard}
          disabled={adding}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-btn bg-brand px-4 py-2 text-sm font-semibold text-white shadow-glow transition-all hover:scale-[1.02] hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {adding ? "Opening…" : "Add card"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {cards === null ? (
        <p className="mt-4 text-sm text-muted">Loading your cards...</p>
      ) : cards.length === 0 ? (
        <div className="mt-4 flex items-center gap-3 rounded-btn border border-dashed border-line bg-surface-2/50 px-4 py-5">
          <CreditCard className="h-5 w-5 text-muted" aria-hidden />
          <p className="text-sm text-muted">
            No saved cards yet. Add one so cash top-ups take a single tap.
          </p>
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {cards.map((card) => (
            <li
              key={card.id}
              className="flex items-center gap-3 rounded-btn border border-line bg-surface-2/50 px-4 py-3"
            >
              <CreditCard className="h-5 w-5 shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground capitalize">
                  {card.brand} •••• {card.last4}
                </p>
                <p className="text-xs text-muted">
                  Expires {String(card.expMonth).padStart(2, "0")}/{card.expYear}
                </p>
              </div>
              {card.isDefault && <StatusPill label="Default" tone="emerald" />}
              {!card.isDefault && (
                <button
                  type="button"
                  onClick={() => setDefault(card.id)}
                  disabled={busyId === card.id}
                  className="inline-flex min-h-[44px] items-center gap-1 rounded-btn border border-line px-3 text-xs font-semibold text-muted transition-colors hover:border-primary/50 hover:text-primary-soft disabled:opacity-50"
                >
                  <Star className="h-3.5 w-3.5" aria-hidden />
                  Make default
                </button>
              )}
              <button
                type="button"
                onClick={() => remove(card)}
                disabled={busyId === card.id}
                aria-label={`Remove ${card.brand} card ending ${card.last4}`}
                className="inline-flex h-11 w-11 items-center justify-center rounded-btn border border-rose-500/40 text-rose-500 transition-colors hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
