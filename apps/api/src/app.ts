import Fastify, { FastifyInstance } from 'fastify';
import { jsonWithBigInt } from '@swapify/db';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { itemsRoutes } from './routes/items.js';
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

  app.register(authPlugin);
  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(itemsRoutes);

  return app;
}
