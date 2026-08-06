import 'dotenv/config';
import { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';

const app: FastifyInstance = await buildApp();

try {
  await app.listen({ port, host });
  app.log.info(`Swapify API listening on http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
