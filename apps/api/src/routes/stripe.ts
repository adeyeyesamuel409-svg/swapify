import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { markPaymentPaid, parseWebhookEvent, simulationAllowed } from '../services/stripe.js';
import { syncConnectedAccountStatus } from '../services/stripe-connect.js';
import { handlePayoutWebhook } from '../services/withdrawal.js';
import {
  buildDisputeEvent,
  handleChargeDisputeWebhook,
  type ChargeDisputeEventType,
} from '../services/disputes.js';
import {
  eventMatchesMode,
  resolveStripeMode,
  type ResolvedStripeMode,
} from '../services/stripe-mode.js';
import { logWebhook } from '../services/webhook-observability.js';
import { prisma } from '@swapify/db';
import pino from 'pino';

const log = pino({ name: 'stripe-webhook', level: process.env.LOG_LEVEL ?? 'info' });

const stripeRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post('/stripe/webhook', async (request, reply) => {
    logWebhook(request, 'received');

    const signature = request.headers['stripe-signature'] as string | undefined;
    const rawBody = request.rawBody;

    if (!signature) {
      logWebhook(request, 'signature_failed', { errName: 'MissingStripeSignature' });
      return reply.code(400).send({ error: 'Missing Stripe signature' });
    }
    if (!rawBody) {
      logWebhook(request, 'signature_failed', { errName: 'MissingRequestBody' });
      return reply.code(400).send({ error: 'Missing request body' });
    }

    let event;
    try {
      event = await parseWebhookEvent(rawBody, signature);
    } catch (err) {
      // Sanitized on purpose: the Stripe signature error object carries the raw
      // request body and the signature header as own properties, so logging the
      // error (as the pre-R14 code did) would leak attacker-controlled input.
      // Log ONLY the error class name.
      logWebhook(request, 'signature_failed', {
        errName: err instanceof Error ? err.name : 'Error',
      });
      return reply.code(400).send({ error: 'Invalid signature' });
    }

    // ── R14 LIVE/TEST mode gate ─────────────────────────────────────────────
    // Runs AFTER signature verification (so the event and its livemode are
    // trusted) and BEFORE any database write, Stripe API call, financial
    // transition, or reconciliation side effect. A TEST event against a LIVE
    // deployment (or the reverse) is dropped here. No schema/mode column is
    // used: wrong-mode events are never written, so each database stays
    // strictly single-mode and the reconciler can never see cross-mode state.
    let mode: ResolvedStripeMode;
    try {
      mode = resolveStripeMode();
    } catch (err) {
      logWebhook(request, 'processing_failed', {
        eventId: event.id,
        eventType: event.type,
        livemode: event.livemode,
        errName: err instanceof Error ? err.name : 'Error',
      });
      return reply.code(500).send({ error: 'Webhook mode configuration invalid' });
    }

    logWebhook(request, 'verified', {
      eventId: event.id,
      eventType: event.type,
      livemode: event.livemode,
      mode,
    });

    if (!eventMatchesMode(event, mode)) {
      // Acknowledge (200) so Stripe does not retry a wrong-mode event for ~3
      // days. Nothing is written and no Stripe call is made.
      logWebhook(request, 'mode_rejected', {
        eventId: event.id,
        eventType: event.type,
        livemode: event.livemode,
        mode,
        httpStatus: 200,
      });
      return reply.code(200).send({ received: true });
    }

    logWebhook(request, 'processing', {
      eventId: event.id,
      eventType: event.type,
      livemode: event.livemode,
      mode,
    });

    let processedOutcome: string | undefined;
    let failed = false;

    // Records a processing failure. Sets `failed` so the terminal "processed"
    // log is never emitted for an event that failed — observability must not
    // report a failed event as successfully processed.
    const fail = (errName: string, httpStatus: number, outcome?: string): void => {
      failed = true;
      logWebhook(request, 'processing_failed', {
        eventId: event.id,
        eventType: event.type,
        livemode: event.livemode,
        mode,
        outcome,
        httpStatus,
        errName,
      });
    };

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const paymentId = session.metadata?.paymentId;

        if (!paymentId) {
          request.log.warn({ sessionId: session.id }, 'Stripe webhook missing paymentId in session metadata');
          fail('MissingPaymentIdMetadata', 500);
          return reply.code(500).send({ error: 'Missing paymentId in session metadata' });
        }

        try {
          const result = await markPaymentPaid(paymentId, session.id, session.payment_intent as string | null);
          processedOutcome = result.alreadyProcessed ? 'idempotent_noop' : 'payment_recorded';
          request.log.info({ paymentId }, 'Recorded payment from Stripe webhook');
        } catch (err) {
          request.log.error({ err, paymentId }, 'Failed to record payment');
          fail(err instanceof Error ? err.name : 'Error', 500, 'payment_record_failed');
          return reply.code(500).send({ error: 'Failed to record payment' });
        }
        break;
      }

      case 'account.updated': {
        const account = event.data.object;
        try {
          await syncConnectedAccountStatus(account.id);
          processedOutcome = 'connected_account_synced';
          request.log.info({ stripeAccountId: account.id }, 'Synced connected account from webhook');
        } catch (err) {
          // Pre-existing contract: a failed account sync is logged and still
          // answered 200 (the reconciler re-syncs). It must NOT be logged as a
          // successful processing.
          request.log.error({ err, stripeAccountId: account.id }, 'Failed to sync connected account');
          fail(err instanceof Error ? err.name : 'Error', 200, 'connected_account_sync_failed');
        }
        break;
      }

      case 'payout.paid': {
        const payout = event.data.object;
        try {
          await handlePayoutWebhook({ stripePayoutId: payout.id, status: 'paid', arrivalDate: payout.arrival_date });
          processedOutcome = 'payout_paid';
        } catch (err) {
          request.log.error({ err, payoutId: payout.id }, 'Failed to process payout.paid');
          fail(err instanceof Error ? err.name : 'Error', 500, 'payout_paid_failed');
          return reply.code(500).send({ error: 'Failed to process payout' });
        }
        break;
      }

      case 'payout.failed': {
        const payout = event.data.object;
        try {
          await handlePayoutWebhook({ stripePayoutId: payout.id, status: 'failed' });
          processedOutcome = 'payout_failed';
        } catch (err) {
          request.log.error({ err, payoutId: payout.id }, 'Failed to process payout.failed');
          fail(err instanceof Error ? err.name : 'Error', 500, 'payout_failed_processing_failed');
          return reply.code(500).send({ error: 'Failed to process payout' });
        }
        break;
      }

      case 'payout.canceled': {
        const payout = event.data.object;
        try {
          await handlePayoutWebhook({ stripePayoutId: payout.id, status: 'canceled' });
          processedOutcome = 'payout_canceled';
        } catch (err) {
          request.log.error({ err, payoutId: payout.id }, 'Failed to process payout.canceled');
          fail(err instanceof Error ? err.name : 'Error', 500, 'payout_canceled_processing_failed');
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
          processedOutcome = 'transfer_failed_ignored';
          const transferId = obj.id as string;
          const metadata = obj.metadata as Record<string, string> | undefined;
          const valueGapId = metadata?.valueGapId;
          if (valueGapId) {
            try {
              await prisma.valueGap.updateMany({
                where: { id: valueGapId, externalPayoutRef: transferId },
                data: { releaseReason: 'TRANSFER_FAILED' },
              });
              processedOutcome = 'transfer_failure_flagged';
              log.warn(
                { transferId, valueGapId },
                'Transfer failed — ValueGap flagged for reconciliation',
              );
            } catch (err) {
              log.error({ err, transferId, valueGapId }, 'Failed to record transfer failure');
              fail(err instanceof Error ? err.name : 'Error', 200, 'transfer_failure_flag_failed');
            }
          }
        } else if (eventType === 'transfer.updated') {
          processedOutcome = 'transfer_updated_logged';
          log.info({ transferId: obj.id, eventType }, 'Transfer event received');
        } else if (
          eventType === 'charge.dispute.created' ||
          eventType === 'charge.dispute.updated' ||
          eventType === 'charge.dispute.closed'
        ) {
          // Deliberately routed, not left to the "Unhandled" default below.
          // A dispute is NOT a refund: it is recorded durably, the payment is
          // frozen, and refundedAt/stripeRefundId are never touched here. Any
          // failure propagates so we answer 500 and Stripe redelivers (the
          // event is already durably captured, so replay is idempotent).
          try {
            const disputeEvent = buildDisputeEvent(
              eventType as ChargeDisputeEventType,
              obj,
              typeof event.created === 'number' ? event.created : null,
              event.id,
            );
            const result = await handleChargeDisputeWebhook(disputeEvent);
            processedOutcome = `dispute_${result.outcome}`;
            request.log.warn(
              {
                disputeId: disputeEvent.dispute.id,
                paymentIntentId: disputeEvent.dispute.paymentIntentId,
                outcome: result.outcome,
                reversalState: result.reversalState,
              },
              'Charge dispute event processed',
            );
          } catch (err) {
            request.log.error(
              { err, eventType, disputeId: obj.id as string },
              'Failed to process charge dispute event',
            );
            fail(err instanceof Error ? err.name : 'Error', 500, 'dispute_processing_failed');
            return reply.code(500).send({ error: 'Failed to process dispute event' });
          }
        } else {
          processedOutcome = 'unhandled_event_ignored';
          request.log.debug({ eventType }, 'Unhandled Stripe webhook event');
        }
      }
    }

    if (!failed) {
      logWebhook(request, 'processed', {
        eventId: event.id,
        eventType: event.type,
        livemode: event.livemode,
        mode,
        outcome: processedOutcome ?? 'handled',
        httpStatus: 200,
      });
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
