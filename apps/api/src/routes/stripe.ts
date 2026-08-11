import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { markPaymentPaid, parseWebhookEvent, simulationAllowed } from '../services/stripe.js';

const stripeRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Stripe's canonical source of truth for completed payments.
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

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const paymentId = session.metadata?.paymentId;

      if (paymentId) {
        try {
          // Idempotent: the payment's unique session id prevents double-entry.
          await markPaymentPaid(paymentId, session.id, session.payment_intent as string | null);
          request.log.info(`Recorded payment ${paymentId} from Stripe webhook`);
        } catch (err) {
          // Stripe retries failed webhooks; markPaymentPaid no-ops once recorded.
          request.log.error(err, `Failed to record payment ${paymentId}`);
          return reply.code(500).send({ error: 'Failed to record payment' });
        }
      }
    }

    return reply.code(200).send({ received: true });
  });

  // Local-dev checkout flow: without a Stripe key outside production, the
  // "Pay" button points here instead of Stripe, so the payment flow is still
  // testable. Never registered in production.
  if (simulationAllowed) {
    app.get('/stripe/dev-confirm/:paymentId', async (request, reply) => {
      const { paymentId } = request.params as { paymentId: string };

      try {
        const payment = await markPaymentPaid(paymentId, null);
        const base = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
        return reply.redirect(`${base}/swaps/${payment.swapId}?paid=1`);
      } catch (err) {
        request.log.error(err, `Failed to confirm simulated payment ${paymentId}`);
        return reply.code(404).send({ error: 'Payment not found' });
      }
    });
  }
};

export { stripeRoutes };
