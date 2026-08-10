import Stripe from 'stripe';
import { TokenOrderStatus, TransactionDirection, TransactionType, prisma } from '@swapify/db';
import { TokenTier } from '@swapify/shared';
import { applyLedgerEntry } from './ledger.js';
import { HttpError } from './swaps.js';

// The simulated checkout is a development convenience ONLY. In production a
// missing Stripe key must never silently credit tokens, so simulation is only
// allowed outside NODE_ENV=production.
export const isProduction = process.env.NODE_ENV === 'production';
export const stripeEnabled = Boolean(process.env.STRIPE_SECRET_KEY);
export const simulationAllowed = !stripeEnabled && !isProduction;

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }
  return stripeClient;
}

export type CheckoutResult =
  | { simulated: true; url: string; sessionId: null }
  | { simulated: false; url: string; sessionId: string };

// Creates a Stripe Checkout session for a token tier. Without a configured
// Stripe key outside production, returns a simulated checkout URL instead so
// the whole flow stays testable. In production a missing key is a
// configuration error and throws (never a simulated payment).
export async function createCheckout(
  tier: TokenTier,
  orderId: string,
  userId: string,
  successUrl: string,
  cancelUrl: string,
): Promise<CheckoutResult> {
  if (!stripeEnabled) {
    if (!simulationAllowed) {
      throw new HttpError(503, 'Payments are not configured on this server');
    }
    return { simulated: true, url: `/stripe/dev-confirm/${orderId}`, sessionId: null };
  }

  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${tier.tokens} Swapify tokens`,
            description: `Token pack: ${tier.tokens} tokens for swapping`,
          },
          unit_amount: tier.priceCents,
        },
        quantity: 1,
      },
    ],
    metadata: { orderId, userId },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  return { simulated: false, url: session.url!, sessionId: session.id };
}

// Marks an order paid and credits the wallet. Called from the webhook and the
// dev-confirm flow. Idempotent: the order's session id and the ledger's
// idempotency key make double-delivery impossible.
export async function creditTokenOrder(orderId: string, stripeSessionId: string | null): Promise<void> {
  const order = await prisma.tokenOrder.findUnique({
    where: { id: orderId },
    include: { user: { include: { wallet: true } } },
  });
  if (!order || !order.user.wallet) {
    throw new Error(`Order ${orderId} or its wallet not found`);
  }
  if (order.status === TokenOrderStatus.PAID) {
    return; // already credited
  }

  if (stripeSessionId && order.stripeCheckoutSessionId && order.stripeCheckoutSessionId !== stripeSessionId) {
    throw new Error(`Session mismatch for order ${orderId}`);
  }

  const result = await applyLedgerEntry({
    walletId: order.user.wallet.id,
    type: TransactionType.PURCHASE,
    direction: TransactionDirection.CREDIT,
    amountMicroTokens: order.tokens * 1_000_000n,
    referenceId: order.id,
    note: `Bought ${order.tokens} tokens (${order.tierId})`,
    idempotencyKey: `purchase:${stripeSessionId ?? order.id}`,
  });
  void result;

  // Only advance the order to PAID after we credited (or already had credited).
  await prisma.tokenOrder.update({
    where: { id: order.id },
    data: {
      status: TokenOrderStatus.PAID,
      paidAt: new Date(),
      stripeCheckoutSessionId: stripeSessionId ?? order.stripeCheckoutSessionId,
      stripePaymentIntentId: order.stripePaymentIntentId,
    },
  });
}

// Verifies a Stripe webhook signature and returns the typed event.
export async function parseWebhookEvent(
  payload: string | Buffer,
  signatureHeader: string,
): Promise<Stripe.Event> {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }
  return getStripe().webhooks.constructEvent(payload, signatureHeader, process.env.STRIPE_WEBHOOK_SECRET);
}
