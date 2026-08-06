import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '@swapify/db';
import { creditTokenOrder, parseWebhookEvent, stripeEnabled } from '../services/stripe.js';

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
      const orderId = session.metadata?.orderId;

      if (orderId) {
        try {
          await creditTokenOrder(orderId, session.id);
          request.log.info(`Credited order ${orderId} from Stripe webhook`);
        } catch (err) {
          // Stripe retries failed webhooks; the ledger idempotency key means
          // a retry will simply no-op once this succeeds.
          request.log.error(err, `Failed to credit order ${orderId}`);
          return reply.code(500).send({ error: 'Failed to credit order' });
        }
      }
    }

    return reply.code(200).send({ received: true });
  });

  // Local-dev checkout flow: without a Stripe key, the "buy" button points
  // here instead of Stripe, so the full purchase flow is still testable.
  if (!stripeEnabled) {
    app.get('/stripe/dev-confirm/:orderId', async (request, reply) => {
      const { orderId } = request.params as { orderId: string };

      const order = await prisma.tokenOrder.findUnique({ where: { id: orderId } });
      if (!order) {
        return reply.code(404).send({ error: 'Order not found' });
      }

      await creditTokenOrder(orderId, null);

      const base = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
      return reply.redirect(`${base}/tokens?paid=1`);
    });
  }
};

export { stripeRoutes };
