import 'dotenv/config';
import { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { startSwapSweeper, stopSwapSweeper } from './services/sweeper.js';
import { startShippingSweeper } from './services/shipping-sweeper.js';
import { resolveAppRole, shouldRunInProcessSweepers, validateConfig } from './config.js';
import { prisma } from '@swapify/db';

// Fail fast on production configuration mistakes before binding the port.
validateConfig();

// This file is the HTTP entry point. Starting it with APP_ROLE=worker would
// serve traffic from a process that is not allowed to reconcile, which looks
// like a healthy API while the scheduled worker does the financial work — fail
// loudly instead and point at the right entry point.
const role = resolveAppRole();
if (role !== 'api') {
  throw new Error(
    `FATAL: APP_ROLE=${role} cannot start the HTTP server. ` +
      'The worker role runs the one-shot reconciler only: use `node apps/api/dist/reconcile-once.js` ' +
      '(or `npm run reconcile:once` in development).',
  );
}

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';

const app: FastifyInstance = await buildApp();

// Periodically expire/refund swaps that never completed in time.
//
// Reconciliation ownership is explicit: with RECONCILE_IN_PROCESS unset the API
// runs this loop (single-task dev/default behaviour). Production sets
// RECONCILE_IN_PROCESS=false and a scheduled worker owns the cycle instead, so
// scaling the API to N tasks (or overlapping during a rolling deploy) no longer
// runs the same financial reconciliation N times.
const runsInProcessSweeper = shouldRunInProcessSweepers();
const swapSweeperHandle = runsInProcessSweeper ? startSwapSweeper() : null;
if (!runsInProcessSweeper) {
  app.log.warn(
    'In-process reconciliation disabled (RECONCILE_IN_PROCESS=false) — this task serves HTTP only. ' +
      'Financial reconciliation must be running on the scheduled reconciler, or money movement stops.',
  );
}

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
  if (swapSweeperHandle !== null) {
    stopSwapSweeper(swapSweeperHandle);
  }
  shippingAbort.abort();
  app.log.info('Sweepers stopped');

  // 3. Disconnect from the database.
  await prisma.$disconnect();
  app.log.info('Database connection closed');

  app.log.info('Shutdown complete');
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
