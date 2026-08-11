import Fastify, { FastifyError, FastifyInstance } from 'fastify';
import rawBody from 'fastify-raw-body';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
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
import { HttpError } from './services/swaps.js';
import { MAX_IMAGE_BYTES, isLocalStorage, resolveUploadDir } from './services/storage.js';
import authPlugin from './plugins/auth.js';
import { mkdir } from 'node:fs/promises';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  });

  // Money is stored as integer GBP pence (Int), which JSON.stringify serializes
  // natively. This serializer remains as a defensive safety net that turns any
  // stray BigInt (e.g. a future Prisma aggregate) into a string instead of
  // failing to serialize.
  app.setReplySerializer((payload: unknown) => jsonWithBigInt(payload));

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

  // The web app runs on a different origin (localhost:3000) than the API
  // (localhost:4000), and authenticated calls send an Authorization header,
  // which triggers CORS preflights. Allow the configured web origin.
  const webOrigin = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
  await app.register(cors, {
    origin: [webOrigin, 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
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

  return app;
}
