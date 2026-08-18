import 'dotenv/config';
import { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { startSwapSweeper } from './services/sweeper.js';
import { startShippingSweeper } from './services/shipping-sweeper.js';
import { validateConfig } from './config.js';

// Fail fast on production configuration mistakes before binding the port.
validateConfig();

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';

const app: FastifyInstance = await buildApp();

// Periodically expire/refund swaps that never completed in time.
startSwapSweeper();

// Poll in-transit shipments and enforce postage/ship deadlines.
startShippingSweeper();

try {
  await app.listen({ port, host });
  app.log.info(`Swapify API listening on http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
