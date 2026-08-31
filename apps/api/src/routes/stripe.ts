import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { markPaymentPaid, parseWebhookEvent, simulationAllowed } from '../services/stripe.js';
import { syncConnectedAccountStatus } from '../services/stripe-connect.js';
import { handlePayoutWebhook } from '../services/withdrawal.js';
import { prisma } from '@swapify/db';
import pino from 'pino';

const log = pino({ name: 'stripe-webhook', level: process.env.LOG_LEVEL ?? 'info' });

const stripeRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post('/stripe/webhook', async (request, reply) => {
    const signature = request.headers['stripe-signature'] as string | undefined;
    const rawBody = request.rawBody;

    if (!signature) {
      return reply.code(400).send({ error: 'Missing Stripe signature' });
    }
    if (!rawBody) {
      return reply.code(400).send({ error: 'Missing request body' });
    }

    let event;
    try {
      event = await parseWebhookEvent(rawBody, signature);
    } catch (err) {
      request.log.warn(err, 'Stripe signature verification failed');
      return reply.code(400).send({ error: 'Invalid signature' });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const paymentId = session.metadata?.paymentId;

        if (!paymentId) {
          request.log.warn({ sessionId: session.id }, 'Stripe webhook missing paymentId in session metadata');
          return reply.code(500).send({ error: 'Missing paymentId in session metadata' });
        }

        try {
          await markPaymentPaid(paymentId, session.id, session.payment_intent as string | null);
          request.log.info({ paymentId }, 'Recorded payment from Stripe webhook');
        } catch (err) {
          request.log.error({ err, paymentId }, 'Failed to record payment');
          return reply.code(500).send({ error: 'Failed to record payment' });
        }
        break;
      }

      case 'account.updated': {
        const account = event.data.object;
        try {
          await syncConnectedAccountStatus(account.id);
          request.log.info({ stripeAccountId: account.id }, 'Synced connected account from webhook');
        } catch (err) {
          request.log.error({ err, stripeAccountId: account.id }, 'Failed to sync connected account');
        }
        break;
      }

      case 'payout.paid': {
        const payout = event.data.object;
        try {
          await handlePayoutWebhook({ stripePayoutId: payout.id, status: 'paid', arrivalDate: payout.arrival_date });
        } catch (err) {
          request.log.error({ err, payoutId: payout.id }, 'Failed to process payout.paid');
          return reply.code(500).send({ error: 'Failed to process payout' });
        }
        break;
      }

      case 'payout.failed': {
        const payout = event.data.object;
        try {
          await handlePayoutWebhook({ stripePayoutId: payout.id, status: 'failed' });
        } catch (err) {
          request.log.error({ err, payoutId: payout.id }, 'Failed to process payout.failed');
          return reply.code(500).send({ error: 'Failed to process payout' });
        }
        break;
      }

      case 'payout.canceled': {
        const payout = event.data.object;
        try {
          await handlePayoutWebhook({ stripePayoutId: payout.id, status: 'canceled' });
        } catch (err) {
          request.log.error({ err, payoutId: payout.id }, 'Failed to process payout.canceled');
          return reply.code(500).send({ error: 'Failed to process payout' });
        }
        break;
      }

      // P2 #15 + P2 #16: Handle additional events that may not be in the
      // SDK's type union for this version. Processed in the default branch
      // with runtime type checking.
      default: {
        const eventType = event.type as string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const obj = event.data.object as any;

        if (eventType === 'transfer.failed') {
          const transferId = obj.id as string;
          const metadata = obj.metadata as Record<string, string> | undefined;
          const valueGapId = metadata?.valueGapId;
          if (valueGapId) {
            try {
              await prisma.valueGap.updateMany({
                where: { id: valueGapId, externalPayoutRef: transferId },
                data: { releaseReason: 'TRANSFER_FAILED' },
              });
              log.warn(
                { transferId, valueGapId },
                'Transfer failed — ValueGap flagged for reconciliation',
              );
            } catch (err) {
              log.error({ err, transferId, valueGapId }, 'Failed to record transfer failure');
            }
          }
        } else if (eventType === 'transfer.updated') {
          log.info({ transferId: obj.id, eventType }, 'Transfer event received');
        } else if (eventType === 'charge.dispute.created') {
          const disputeId = obj.id as string;
          const paymentIntentId = typeof obj.payment_intent === 'string'
            ? obj.payment_intent
            : (obj.payment_intent as { id: string } | null)?.id;
          if (paymentIntentId) {
            try {
              await prisma.payment.updateMany({
                where: { stripePaymentIntentId: paymentIntentId },
                data: { refundedAt: new Date(), stripeRefundId: disputeId },
              });
              log.warn(
                { disputeId, paymentIntentId, reason: obj.reason },
                'Charge dispute created — payment flagged for review',
              );
            } catch (err) {
              log.error({ err, disputeId }, 'Failed to record dispute');
            }
          }
        } else {
          request.log.debug({ eventType }, 'Unhandled Stripe webhook event');
        }
      }
        request.log.debug({ eventType: event.type }, 'Unhandled Stripe webhook event');
    }

    return reply.code(200).send({ received: true });
  });

  // Local-dev checkout flow: without a Stripe key outside production, the
  // "Pay" button points here instead of Stripe, so the payment flow is still
  // testable. Never registered in production.
  if (simulationAllowed) {
    app.get('/stripe/dev-confirm/:paymentId', {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 10, timeWindow: 60_000 } },
    }, async (request, reply) => {
      const { paymentId } = request.params as { paymentId: string };

      try {
        const payment = await markPaymentPaid(paymentId, null);
        const base = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
        return reply.redirect(`${base}/swaps/${payment.swapId}?paid=1`);
      } catch (err) {
        request.log.error({ err, paymentId }, 'Failed to confirm simulated payment');
        return reply.code(404).send({ error: 'Payment not found' });
      }
    });
  }
};

export { stripeRoutes };
