import Stripe from 'stripe';
import { PaymentStatus, SwapStatus, prisma } from '@swapify/db';
import { HttpError } from './swaps.js';
import { notify } from './notifications.js';
import { createSwapShipments } from './shipping.js';
import { allocateValueGap, refundValueGap } from './value-gap.js';
import pino from 'pino';

const log = pino({ name: 'stripe', level: process.env.LOG_LEVEL ?? 'info' });

// The simulated checkout is a development convenience ONLY. In production a
// missing Stripe key must never silently take money, so simulation is only
// allowed outside NODE_ENV=production.
export const isProduction = process.env.NODE_ENV === 'production';
export const stripeEnabled = Boolean(process.env.STRIPE_SECRET_KEY);
export const simulationAllowed = !stripeEnabled && !isProduction;

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }
  return stripeClient;
}

export type CheckoutResult =
  | { simulated: true; url: string; sessionId: null }
  | { simulated: false; url: string; sessionId: string };

// Creates a Stripe Checkout session for a swap's gap payment. The single
// payment covers the value difference the payer owes plus the Swapify service
// fee, both in GBP pence. Without a configured Stripe key outside production,
// returns a simulated checkout URL so the whole flow stays testable. In
// production a missing key is a configuration error and throws (never a
// simulated payment).
export async function createSwapPaymentCheckout(
  payment: {
    id: string;
    swapId: string;
    amountPence: number;
    feePence: number;
    totalPence: number;
  },
  higherValuePence: number,
  successUrl: string,
  cancelUrl: string,
): Promise<CheckoutResult> {
  if (!stripeEnabled) {
    if (!simulationAllowed) {
      throw new HttpError(503, 'Payments are not configured on this server');
    }
    return { simulated: true, url: `/stripe/dev-confirm/${payment.id}`, sessionId: null };
  }

  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'gbp',
          product_data: { name: 'Swap value difference' },
          unit_amount: payment.amountPence,
        },
        quantity: 1,
      },
      {
        price_data: {
          currency: 'gbp',
          product_data: { name: 'Swapify service fee' },
          unit_amount: payment.feePence,
        },
        quantity: 1,
      },
    ],
    metadata: { paymentId: payment.id, swapId: payment.swapId },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  return { simulated: false, url: session.url!, sessionId: session.id };
}

// Marks a swap's payment as PAID and advances the swap to PAID. Called from the
// webhook and the dev-confirm flow. Idempotent: the payment's unique session id
// means the same charge can never be recorded twice.
//
// The payment ledger is always kept accurate - if Stripe says the charge
// succeeded, the Payment row becomes PAID even when the swap is no longer
// eligible. But the swap only advances to PAID via an atomic conditional
// update (AGREED -> PAID): a swap that expired or was cancelled concurrently
// stays terminal and is NEVER resurrected. In that case the recorded payment
// is picked up by the refund/reconciliation path (refundSwapPayment /
// reconcileRefunds) and the money is returned, matching the existing
// cancel/expire-after-pay behaviour.
export async function markPaymentPaid(
  paymentId: string,
  stripeSessionId: string | null,
  stripePaymentIntentId?: string | null,
): Promise<{ id: string; swapId: string }> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { swap: { include: { offeringUser: { select: { name: true } } } } },
  });
  if (!payment) {
    throw new Error(`Payment ${paymentId} not found`);
  }
  if (payment.status === PaymentStatus.PAID) {
    // Already recorded — ensure shipments exist (crash-recovery idempotency)
    const shipmentCount = await prisma.shipment.count({ where: { swapId: payment.swapId } });
    if (shipmentCount < 2) {
      await prisma.$transaction(async (tx) => {
        await createSwapShipments(tx, payment.swapId, new Date());
      });
    }
    return { id: payment.id, swapId: payment.swapId };
  }

  if (stripeSessionId && payment.stripeCheckoutSessionId && payment.stripeCheckoutSessionId !== stripeSessionId) {
    throw new Error(`Session mismatch for payment ${paymentId}`);
  }

  const [, swapClaim] = await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.PAID,
        paidAt: new Date(),
        stripeCheckoutSessionId: stripeSessionId ?? payment.stripeCheckoutSessionId,
        stripePaymentIntentId: stripePaymentIntentId ?? payment.stripePaymentIntentId,
      },
    }),
    prisma.swap.updateMany({
      where: { id: payment.swapId, status: SwapStatus.AGREED },
      data: { status: SwapStatus.PAID },
    }),
  ]);
  const advanced = swapClaim.count === 1;

  if (advanced) {
    // Allocate the value gap ledger record atomically.
    // If the payment has a positive gap, create the ledger entry.
    // For equal-value swaps (gapPence === 0), no ledger record is created.
    if (payment.amountPence > 0) {
      try {
        await prisma.$transaction(async (tx) => {
          await allocateValueGap(tx, {
            paymentId: payment.id,
            swapId: payment.swapId,
            payerUserId: payment.payerUserId,
            valueGapPence: payment.amountPence,
            serviceFeePence: payment.feePence,
          });
        });
      } catch (err) {
        log.error({ err, paymentId: payment.id, swapId: payment.swapId }, 'Failed to allocate value gap');
        // Non-fatal for payment confirmation itself, but the value gap must be
        // reconciled. The payment is already PAID; the sweeper/reconciliation
        // will pick up any missing ledger records.
      }
    }

    // Value-gap: create both shipment legs now that payment is confirmed
    const createdSwap = await prisma.swap.findUnique({ where: { id: payment.swapId } });
    if (createdSwap && createdSwap.gapPence > 0) {
      try {
        await prisma.$transaction(async (tx) => {
          await createSwapShipments(tx, payment.swapId, new Date());
        });
      } catch (err) {
        // Best-effort: if shipment creation fails, markPaymentPaid will be
        // retried and the early-return path handles crash recovery.
        log.warn({ err, paymentId: payment.id, swapId: payment.swapId }, 'Failed to create shipments after payment');
      }
    }

    const otherParty =
      payment.swap.offeringUserId === payment.payerUserId
        ? payment.swap.requestedUserId
        : payment.swap.offeringUserId;

    await notify(otherParty, 'ESCROW', 'The value-gap payment has been received', payment.swapId);
    await notify(payment.payerUserId, 'SWAP_UPDATE', 'Payment confirmed - your swap is ready', payment.swapId);
  }

  return { id: payment.id, swapId: payment.swapId };
}

// Best-effort refund of a swap's gap payment via Stripe. Used when a swap is
// cancelled or expires after the payer has already paid. Safe to call in the
// simulated flow (no real charge exists, so it no-ops).
//
// Value-gap integration:
//   1. Before issuing the Stripe refund, the internal value gap ledger is
//      transitioned to REFUNDED. If the value gap is already RELEASED, the
//      refund is blocked (requires dispute/recovery workflow).
//   2. If a Transfer has already been sent to the connected account (value gap
//      is RELEASED with an externalPayoutRef), the Transfer is reversed BEFORE
//      refunding the original payment. This pulls funds back from the connected
//      account to the platform balance so the Stripe refund can succeed.
//
// CURRENT REFUND BEHAVIOR: This function refunds the FULL original Stripe
// payment (value gap + service fee) in a single Stripe refund.
//
// Concurrency/idempotency guarantees:
// - A payment that has already been refunded (`refundedAt` set) is a no-op.
// - The Stripe refund is created with an idempotency key derived from the
//   payment id, so a retry can never mint a second refund.
// - On success the refund is durably recorded on the Payment row with a
//   conditional update (`where refundedAt: null`).
export async function refundSwapPayment(paymentId: string): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.status !== PaymentStatus.PAID || payment.refundedAt) {
    return;
  }
  if (!payment.stripePaymentIntentId) {
    return; // simulated payment - nothing was charged
  }
  if (!stripeEnabled) {
    return; // simulated flow - no real charge exists
  }

  // Refund the value gap ledger first (HELD → REFUNDED).
  // If the value gap is already RELEASED, we cannot automatically refund —
  // this requires a dispute/recovery workflow. Log and skip.
  const valueGapRefunded = await prisma.$transaction(async (tx) => {
    return refundValueGap(tx, paymentId, 'SWAP_CANCELLED_OR_EXPIRED');
  });
  if (!valueGapRefunded) {
    log.warn(
      { paymentId, swapId: payment.swapId },
      'ValueGap refund was not performed — may be RELEASED (requires dispute workflow)',
    );
  }

  // If the value gap was RELEASED and a transfer was sent, reverse it first.
  // This pulls funds back from the connected account so the original payment
  // can be refunded. The reversal is idempotent (Stripe returns the existing
  // reversal if one already exists for the same transfer).
  const valueGap = await prisma.valueGap.findUnique({ where: { paymentId } });
  if (valueGap?.state === 'RELEASED' && valueGap.externalPayoutRef) {
    try {
      const { reverseTransfer } = await import('./stripe-connect.js');
      await reverseTransfer({
        transferId: valueGap.externalPayoutRef,
        amountPence: valueGap.valueGapPence,
        valueGapId: valueGap.id,
      });
      log.info(
        { paymentId, transferId: valueGap.externalPayoutRef, valueGapId: valueGap.id },
        'Reversed Stripe transfer before refunding payment',
      );
    } catch (err) {
      log.error(
        { err, paymentId, transferId: valueGap.externalPayoutRef },
        'Failed to reverse transfer before refund — aborting refund for safety',
      );
      // P0 SAFETY: Do NOT continue with the refund if the transfer reversal
      // fails. Continuing would result in money leaving the platform without
      // the corresponding transfer being reversed, causing a net loss.
      return;
    }
  } else if (valueGap?.state === 'RELEASED' && !valueGap.externalPayoutRef) {
    // RELEASED gap with no transfer reference — anomaly. Do NOT blindly refund
    // as this could result in a net loss if a transfer exists on Stripe but
    // was never recorded.
    log.error(
      { paymentId, valueGapId: valueGap.id, state: valueGap.state },
      'ANOMALY: ValueGap is RELEASED but missing externalPayoutRef — refusing refund for safety',
    );
    return;
  }

  try {
    const refund = await getStripe().refunds.create(
      { payment_intent: payment.stripePaymentIntentId },
      { idempotencyKey: `refund-${payment.id}` },
    );
    await prisma.payment.updateMany({
      where: { id: payment.id, refundedAt: null },
      data: { refundedAt: new Date(), stripeRefundId: refund.id },
    });
  } catch (err) {
    log.error({ err, paymentId }, 'Failed to refund payment');
  }
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
