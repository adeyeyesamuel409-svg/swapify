import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '@swapify/db';
import { hashPassword, verifyPassword, signAccessToken } from '../services/auth.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

const authRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Returns the current user.
  app.get('/auth/me', { preHandler: [app.authenticate] }, async (request) => {
    return { user: request.user };
  });

  // Create an email+password account. Returns an API access token so the client
  // can sign in immediately after registering.
  app.post(
    '/auth/signup',
    { config: { rateLimit: { max: 10, timeWindow: 60_000 } } },
    async (request, reply) => {
      const body = (request.body ?? {}) as { email?: string; password?: string; name?: string };
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const name = typeof body.name === 'string' ? body.name.trim() : '';

      if (!EMAIL_RE.test(email)) {
        return reply.code(400).send({ error: 'Enter a valid email address.' });
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        return reply
          .code(400)
          .send({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
      }

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return reply.code(409).send({ error: 'An account with that email already exists.' });
      }

      const passwordHash = await hashPassword(password);
      const user = await prisma.user.create({
        data: {
          email,
          name: name || 'Swapify User',
          passwordHash,
        },
        include: { admin: true },
      });

      const token = await signAccessToken(user);
      return reply.code(201).send({
        token,
        user: { id: user.id, email: user.email, name: user.name, admin: user.admin },
      });
    },
  );

  // Verify an email+password pair and return an API access token.
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: 60_000 } } },
    async (request, reply) => {
      const body = (request.body ?? {}) as { email?: string; password?: string };
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';

      if (!email || !password) {
        return reply.code(400).send({ error: 'Email and password are required.' });
      }

      const user = await prisma.user.findUnique({
        where: { email },
        include: { admin: true },
      });
      if (!user || !user.passwordHash) {
        // Same message for unknown user and wrong password — no account probing.
        return reply.code(401).send({ error: 'Invalid email or password.' });
      }

      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) {
        return reply.code(401).send({ error: 'Invalid email or password.' });
      }

      const token = await signAccessToken(user);
      return reply.send({
        token,
        user: { id: user.id, email: user.email, name: user.name, admin: user.admin },
      });
    },
  );
};

export { authRoutes };
