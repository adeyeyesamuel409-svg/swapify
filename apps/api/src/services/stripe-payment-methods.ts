// ---------------------------------------------------------------------------
// Saved payment cards (buyer side)
//
// Each user maps to one Stripe Customer (User.stripeCustomerId). Card details
// are only ever held by Stripe: cards are added through the Stripe-hosted
// setup page (Checkout mode "setup"), listed via the API, and removed by
// detaching the PaymentMethod. Nothing card-shaped touches our database.
// ---------------------------------------------------------------------------

import { prisma } from '@swapify/db';
import { getStripe, stripeEnabled } from './stripe.js';
import pino from 'pino';

const log = pino({ name: 'payment-methods', level: process.env.LOG_LEVEL ?? 'info' });

export class PaymentMethodError extends Error {}

function requireStripe() {
  if (!stripeEnabled) {
    throw new PaymentMethodError('Stripe is not configured');
  }
  return getStripe();
}

// Returns the user's Stripe Customer, creating it on first use.
export async function getOrCreateStripeCustomer(
  userId: string,
  email: string,
): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new PaymentMethodError('User not found');
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const stripe = requireStripe();
  const customer = await stripe.customers.create({
    email,
    metadata: { userId },
  });
  await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customer.id } });
  log.info({ userId }, 'Stripe customer created');
  return customer.id;
}

// Hosted card-entry page: Stripe Checkout in setup mode. The user adds a card
// on Stripe's own form and is redirected back to Swapify.
export async function createCardSetupSession(
  userId: string,
  email: string,
  returnBaseUrl: string,
): Promise<{ url: string }> {
  const stripe = requireStripe();
  const customerId = await getOrCreateStripeCustomer(userId, email);
  const session = await stripe.checkout.sessions.create({
    mode: 'setup',
    customer: customerId,
    currency: 'gbp',
    payment_method_types: ['card'],
    success_url: `${returnBaseUrl}/profile?cards=added`,
    cancel_url: `${returnBaseUrl}/profile?cards=cancelled`,
  });
  if (!session.url) throw new PaymentMethodError('No setup URL returned');
  log.info({ userId }, 'Card setup session created');
  return { url: session.url };
}

export type SavedCard = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
};

export async function listSavedCards(userId: string): Promise<SavedCard[]> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.stripeCustomerId) return [];
  const stripe = requireStripe();
  const [methods, customer] = await Promise.all([
    stripe.customers.listPaymentMethods(user.stripeCustomerId, { type: 'card' }),
    stripe.customers.retrieve(user.stripeCustomerId),
  ]);
  const defaultId =
    (customer as { invoice_settings?: { default_payment_method?: string | null } })
      .invoice_settings?.default_payment_method ?? null;
  return methods.data.map((pm) => ({
    id: pm.id,
    brand: pm.card?.brand ?? 'card',
    last4: pm.card?.last4 ?? '????',
    expMonth: pm.card?.exp_month ?? 0,
    expYear: pm.card?.exp_year ?? 0,
    isDefault: pm.id === defaultId || (!defaultId && pm.id === methods.data[0]?.id),
  }));
}

export async function setDefaultPaymentMethod(userId: string, paymentMethodId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.stripeCustomerId) throw new PaymentMethodError('No saved cards');
  const stripe = requireStripe();
  await stripe.customers.update(user.stripeCustomerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });
  log.info({ userId }, 'Default payment method set');
}

export async function removePaymentMethod(userId: string, paymentMethodId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.stripeCustomerId) throw new PaymentMethodError('No saved cards');
  const stripe = requireStripe();
  await stripe.paymentMethods.detach(paymentMethodId);
  log.info({ userId }, 'Payment method removed');
}
