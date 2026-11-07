import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  createCardSetupSession,
  getOrCreateStripeCustomer,
  listSavedCards,
  PaymentMethodError,
  removePaymentMethod,
  setDefaultPaymentMethod,
} from '../services/stripe-payment-methods.js';
import { HttpError } from '../services/swaps.js';

const idParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
} as const;

// Saved payment cards (buyer side) - Stripe Customer + hosted card setup.
const paymentMethodRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const guard = async (fn: () => Promise<unknown>): Promise<unknown> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof PaymentMethodError) throw new HttpError(400, err.message);
      throw err;
    }
  };

  // List saved cards (brand, last4, expiry, default flag).
  app.get('/users/me/payment-methods', { preHandler: [app.authenticate] }, async (request) => {
    const cards = await guard(() => listSavedCards(request.user!.id));
    return { cards };
  });

  // Returns a Stripe-hosted page where the user adds a card.
  app.post('/users/me/payment-methods/setup', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 10, timeWindow: 60_000 } },
  }, async (request) => {
    const user = request.user!;
    const email = user.email ?? `${user.id}@swapifyuk.com`;
    const returnBaseUrl = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
    return guard(() => createCardSetupSession(user.id, email, returnBaseUrl));
  });

  app.post('/users/me/payment-methods/:id/default', { preHandler: [app.authenticate], schema: idParamsSchema }, async (request) => {
    const { id } = request.params as { id: string };
    await guard(() => setDefaultPaymentMethod(request.user!.id, id));
    return { ok: true };
  });

  app.delete('/users/me/payment-methods/:id', { preHandler: [app.authenticate], schema: idParamsSchema }, async (request) => {
    const { id } = request.params as { id: string };
    await guard(() => removePaymentMethod(request.user!.id, id));
    return { ok: true };
  });
};

export { paymentMethodRoutes, getOrCreateStripeCustomer };
