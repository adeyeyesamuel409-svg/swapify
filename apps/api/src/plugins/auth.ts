import fp from 'fastify-plugin';
import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { createSecretKey } from 'node:crypto';
import { jwtVerify, JWTPayload } from 'jose';
import { prisma, Admin, User } from '@swapify/db';
import { AUTH_CONSTANTS } from '../services/auth.js';

export interface AuthenticatedUser extends User {
  admin: Admin | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

// Auth migration (off AWS Cognito): API access tokens are HMAC-SHA256 JWTs
// signed with the shared AUTH_SECRET and issued by /auth/login or /auth/signup.
// The `sub` claim carries the local user id.

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('FATAL: AUTH_SECRET must be set to a value of at least 32 characters.');
  }
  return createSecretKey(Buffer.from(secret, 'utf8'));
}

const authPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing bearer token' });
    }

    let payload: JWTPayload;
    try {
      const verified = await jwtVerify(authHeader.slice('Bearer '.length), secretKey(), {
        issuer: AUTH_CONSTANTS.ISSUER,
        audience: AUTH_CONSTANTS.AUDIENCE,
      });
      payload = verified.payload;
    } catch (err) {
      request.log.warn({ err }, 'JWT verification failed');
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }

    const userId = typeof payload.sub === 'string' ? payload.sub : undefined;
    if (!userId) {
      return reply.code(401).send({ error: 'Invalid token' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { admin: true },
    });
    if (!user) {
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }

    request.user = user;
  });
};

export default fp(authPlugin, {
  name: 'swapify-auth',
});
