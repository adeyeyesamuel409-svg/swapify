import Fastify, { FastifyError, FastifyInstance } from 'fastify';
import rawBody from 'fastify-raw-body';
import { jsonWithBigInt } from '@swapify/db';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { itemsRoutes } from './routes/items.js';
import { walletRoutes } from './routes/wallet.js';
import { swapRoutes } from './routes/swaps.js';
import { tokenOrderRoutes } from './routes/token-orders.js';
import { stripeRoutes } from './routes/stripe.js';
import { HttpError } from './services/swaps.js';
import authPlugin from './plugins/auth.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  });

  // Token amounts are BigInt, which JSON.stringify cannot serialize.
  // This ensures every response serializes them as strings safely.
  app.setReplySerializer((payload: unknown) => jsonWithBigInt(payload));

  // Stripe webhook signature verification needs the raw request body.
  app.register(rawBody);

  // Expected business errors (bad input, conflicts, missing resources) get
  // their proper status code; everything else is a logged 500.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    // Preserve Fastify's own client errors (e.g. 400 schema validation).
    const fastifyError = error as FastifyError;
    const statusCode = typeof fastifyError.statusCode === 'number' ? fastifyError.statusCode : 500;
    if (statusCode >= 500) {
      request.log.error(error);
    }
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? 'Internal server error' : fastifyError.message,
    });
  });

  app.register(authPlugin);
  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(itemsRoutes);
  app.register(walletRoutes);
  app.register(swapRoutes);
  app.register(tokenOrderRoutes);
  app.register(stripeRoutes);

  return app;
}
