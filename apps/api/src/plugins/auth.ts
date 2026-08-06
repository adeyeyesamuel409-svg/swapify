import fp from 'fastify-plugin';
import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { prisma, TransactionDirection, TransactionType, User, Wallet } from '@swapify/db';
import {
  applyLedgerEntry,
  MICRO_TOKENS_PER_TOKEN,
  WELCOME_BONUS_TOKENS,
} from '../services/ledger.js';

export interface AuthenticatedUser extends User {
  wallet: Wallet | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const region = process.env.COGNITO_REGION ?? 'us-east-1';
const userPoolId = process.env.COGNITO_USER_POOL_ID;
const clientId = process.env.COGNITO_CLIENT_ID;

const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

// A user's first authenticated request creates their local record + wallet.
// Subsequent requests just update the name/email in case they changed in Cognito.
async function syncUserFromCognito(payload: JWTPayload): Promise<AuthenticatedUser> {
  const sub = String(payload.sub);
  const email = typeof payload.email === 'string' ? payload.email : undefined;
  const name =
    typeof payload.name === 'string'
      ? payload.name
      : typeof payload['cognito:username'] === 'string'
        ? payload['cognito:username']
        : 'Swapify User';

  const existing = await prisma.user.findUnique({ where: { cognitoSub: sub } });

  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        ...(email && email !== existing.email ? { email } : {}),
        name,
      },
      include: { wallet: true },
    });
  }

  // No local record yet - create user + wallet, then grant the welcome bonus.
  // The idempotency key guarantees the bonus is only ever granted once.
  const created = await prisma.user.create({
    data: {
      cognitoSub: sub,
      email: email ?? `${sub}@cognito.invalid`,
      name,
      wallet: { create: {} },
    },
    include: { wallet: true },
  });

  await applyLedgerEntry({
    walletId: created.wallet!.id,
    type: TransactionType.EARN,
    direction: TransactionDirection.CREDIT,
    amountMicroTokens: WELCOME_BONUS_TOKENS * MICRO_TOKENS_PER_TOKEN,
    note: 'Welcome bonus',
    idempotencyKey: `welcome:${sub}`,
  });

  return prisma.user.findUniqueOrThrow({
    where: { id: created.id },
    include: { wallet: true },
  });
}

const authPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing bearer token' });
    }

    try {
      const { payload } = await jwtVerify(authHeader.slice('Bearer '.length), jwks, {
        issuer,
      });

      // Only access tokens grant API access, never ID tokens.
      if (payload.token_use !== 'access') {
        return reply.code(401).send({ error: 'Invalid token type' });
      }

      // Cognito access tokens carry the app client in `client_id` (no `aud`).
      if (payload.client_id !== clientId) {
        return reply.code(401).send({ error: 'Token issued for another client' });
      }

      request.user = await syncUserFromCognito(payload);
    } catch (err) {
      request.log.warn({ err }, 'JWT verification failed');
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }
  });
};

export default fp(authPlugin, {
  name: 'swapify-auth',
});
