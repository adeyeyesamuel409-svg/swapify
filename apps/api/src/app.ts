import Fastify, { FastifyError, FastifyInstance } from 'fastify';
import rawBody from 'fastify-raw-body';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { jsonWithBigInt } from '@swapify/db';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { itemsRoutes } from './routes/items.js';
import { swapRoutes } from './routes/swaps.js';
import { stripeRoutes } from './routes/stripe.js';
import { chatRoutes } from './routes/chat.js';
import { ratingRoutes } from './routes/ratings.js';
import { userRoutes } from './routes/users.js';
import { wishlistRoutes } from './routes/wishlists.js';
import { notificationRoutes } from './routes/notifications.js';
import { adminRoutes } from './routes/admin.js';
import { uploadRoutes } from './routes/uploads.js';
import { shippingRoutes } from './routes/shipping.js';
import { balanceRoutes } from './routes/balance.js';
import { connectRoutes } from './routes/connect.js';
import { withdrawalRoutes } from './routes/withdrawals.js';
import { wireStripeConnect } from './services/stripe-connect.js';
import { HttpError } from './services/swaps.js';
import { MAX_IMAGE_BYTES, isLocalStorage, resolveUploadDir } from './services/storage.js';
import authPlugin from './plugins/auth.js';
import { mkdir } from 'node:fs/promises';

const isProduction = process.env.NODE_ENV === 'production';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
    trustProxy: isProduction,
  });

  // Money is stored as integer GBP pence (Int), which JSON.stringify serializes
  // natively. This serializer remains as a defensive safety net that turns any
  // stray BigInt (e.g. a future Prisma aggregate) into a string instead of
  // failing to serialize.
  app.setReplySerializer((payload: unknown) => jsonWithBigInt(payload));

  // Activate the Stripe Connect disbursement provider when Stripe is
  // configured. Must run before route registration so the provider is
  // available when ValueGap release notifies the disbursement provider.
  wireStripeConnect();

  // Stripe webhook signature verification needs the raw request body.
  app.register(rawBody);

  // Multipart uploads for listing images. Enforced server-side: max 5 MB per
  // file, max 8 files per request (limits apply while streaming the body).
  await app.register(multipart, {
    limits: { fileSize: MAX_IMAGE_BYTES, files: 8 },
  });

  // Serve uploaded listing images from local disk. Only needed for the local
  // storage driver; in production the CloudFront distribution serves objects
  // directly from S3.
  if (isLocalStorage()) {
    const uploadDir = resolveUploadDir();
    await mkdir(uploadDir, { recursive: true });
    await app.register(fastifyStatic, {
      root: uploadDir,
      prefix: '/uploads/',
      maxAge: '7d',
      decorateReply: false,
    });
  }

  // CORS: production origins come from environment variables only.
  // localhost:3000 is permitted only in development for local DX.
  const webOrigin = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
  const origins: string[] = [webOrigin];
  if (!isProduction) {
    origins.push('http://localhost:3000');
  }
  await app.register(cors, {
    origin: origins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // ── Rate limiting ────────────────────────────────────────────────────────
  // Global default: 200 requests/min/IP — generous enough for normal browsing
  // while blocking brute-force and scripted abuse. Sensitive routes get
  // tighter per-route limits applied via route-level config.
  await app.register(rateLimit, {
    max: 200,
    timeWindow: 60 * 1000,
    addHeadersOnExceeding: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true },
    addHeaders: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true, 'retry-after': true },
    errorResponseBuilder: (_request, context) => ({
      error: 'Too many requests — please try again later',
      statusCode: 429,
      retryAfter: Math.ceil(context.ttl / 1000),
    }),
  });

  // ── Security headers ─────────────────────────────────────────────────────
  // Applied via an onRequest hook so they are present on every response
  // without adding a new dependency.
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-XSS-Protection', '0'); // Modern browsers: disabled in favour of CSP
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (isProduction) {
      reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    }
  });

  // Expected business errors (bad input, conflicts, missing resources) get
  // their proper status code; everything else is a logged 500.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    // Multipart limits surface as Fastify errors while streaming the body.
    const code = (error as FastifyError).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: 'Image too large - max 5 MB per file' });
    }
    if (code === 'FST_REQ_TOO_MANY_FILES' || code === 'FST_FILES_LIMIT') {
      return reply.code(400).send({ error: 'Too many files - a maximum of 8 images is allowed' });
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
  app.register(swapRoutes);
  app.register(stripeRoutes);
  app.register(chatRoutes);
  app.register(ratingRoutes);
  app.register(userRoutes);
  app.register(uploadRoutes);
  app.register(wishlistRoutes);
  app.register(notificationRoutes);
  app.register(adminRoutes);
  app.register(shippingRoutes);
  app.register(balanceRoutes);
  app.register(connectRoutes);
  app.register(withdrawalRoutes);

  return app;
}
