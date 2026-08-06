import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { TokenOrderStatus, prisma } from '@swapify/db';
import { TOKEN_TIERS } from '@swapify/shared';
import { HttpError } from '../services/swaps.js';
import { createCheckout } from '../services/stripe.js';

const checkoutSchema = {
  body: {
    type: 'object',
    required: ['tierId', 'successUrl', 'cancelUrl'],
    properties: {
      tierId: { type: 'string' },
      successUrl: { type: 'string', minLength: 1, maxLength: 500 },
      cancelUrl: { type: 'string', minLength: 1, maxLength: 500 },
    },
  },
} as const;

const tokenOrderRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // My purchase history.
  app.get('/token-orders', { preHandler: [app.authenticate] }, async (request) => {
    const user = request.user!;

    const orders = await prisma.tokenOrder.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return { orders };
  });

  // Kick off a Stripe Checkout session for a token tier.
  app.post('/token-orders/checkout', { preHandler: [app.authenticate], schema: checkoutSchema }, async (request) => {
    const user = request.user!;
    const body = request.body as { tierId: string; successUrl: string; cancelUrl: string };

    const tier = TOKEN_TIERS.find((t) => t.id === body.tierId);
    if (!tier) {
      throw new HttpError(400, 'Unknown token tier');
    }

    const order = await prisma.tokenOrder.create({
      data: {
        userId: user.id,
        tierId: tier.id,
        tokens: BigInt(tier.tokens),
        priceCents: tier.priceCents,
        status: TokenOrderStatus.PENDING,
      },
    });

    const checkout = await createCheckout(tier, order.id, user.id, body.successUrl, body.cancelUrl);

    if (checkout.sessionId) {
      await prisma.tokenOrder.update({
        where: { id: order.id },
        data: { stripeCheckoutSessionId: checkout.sessionId },
      });
    }

    return { url: checkout.url, simulated: checkout.simulated, order };
  });
};

export { tokenOrderRoutes };
