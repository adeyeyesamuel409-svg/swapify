import 'dotenv/config';
import { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { startSwapSweeper, stopSwapSweeper } from './services/sweeper.js';
import { startShippingSweeper } from './services/shipping-sweeper.js';
import { validateConfig } from './config.js';
import { prisma } from '@swapify/db';

// Fail fast on production configuration mistakes before binding the port.
validateConfig();

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';

const app: FastifyInstance = await buildApp();

// Periodically expire/refund swaps that never completed in time.
const swapSweeperHandle = startSwapSweeper();

// Poll in-transit shipments and enforce postage/ship deadlines.
const shippingAbort = new AbortController();
void startShippingSweeper(shippingAbort.signal);

try {
  await app.listen({ port, host });
  app.log.info({ port, host }, 'Swapify API listening');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Graceful shutdown (SIGTERM from ECS, SIGINT from Ctrl-C)
// ---------------------------------------------------------------------------

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  app.log.info({ signal }, 'Shutdown signal received — closing down');

  // 1. Stop accepting new connections.
  await app.close();
  app.log.info('Fastify closed — no new requests accepted');

  // 2. Stop background sweepers.
  stopSwapSweeper(swapSweeperHandle);
  shippingAbort.abort();
  app.log.info('Sweepers stopped');

  // 3. Disconnect from the database.
  await prisma.$disconnect();
  app.log.info('Database connection closed');

  app.log.info('Shutdown complete');
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
