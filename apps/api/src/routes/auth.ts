import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '@swapify/db';
import {
  consumeEmailCode,
  hashPassword,
  issueEmailCode,
  signAccessToken,
  verifyPassword,
} from '../services/auth.js';
import { sendPasswordResetCode, sendVerificationCode } from '../services/email.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

const authRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Returns the current user.
  app.get('/auth/me', { preHandler: [app.authenticate] }, async (request) => {
    return { user: request.user };
  });

  // Create an email+password account. The account starts UNVERIFIED: a 6-digit
  // code is emailed and login is blocked until the code is accepted.
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
      });

      try {
        const issued = await issueEmailCode(user.id, email, 'EMAIL_VERIFY');
        if (issued.code) {
          await sendVerificationCode(email, user.name, issued.code);
        }
      } catch (err) {
        request.log.error({ err }, 'Failed to send verification email');
      }

      return reply.code(201).send({ status: 'verification_required', email });
    },
  );

  // Accept the emailed 6-digit code and activate the account.
  app.post(
    '/auth/verify-email',
    { config: { rateLimit: { max: 20, timeWindow: 60_000 } } },
    async (request, reply) => {
      const body = (request.body ?? {}) as { email?: string; code?: string };
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const code = typeof body.code === 'string' ? body.code.trim() : '';
      if (!email || !code) {
        return reply.code(400).send({ error: 'Email and code are required.' });
      }

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return reply.code(400).send({ error: 'Invalid code.' });
      }

      const result = await consumeEmailCode(email, 'EMAIL_VERIFY', code);
      if (result !== 'ok') {
        const message =
          result === 'expired'
            ? 'That code has expired. Request a new one.'
            : result === 'attempts_exceeded'
              ? 'Too many incorrect attempts. Request a new code.'
              : 'Invalid code.';
        return reply.code(400).send({ error: message });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: new Date() },
      });
      return { verified: true };
    },
  );

  // Re-send the verification code (throttled server-side to 1/min per user).
  app.post(
    '/auth/resend-verification',
    { config: { rateLimit: { max: 5, timeWindow: 60_000 } } },
    async (request, reply) => {
      const body = (request.body ?? {}) as { email?: string };
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!email) return reply.code(400).send({ error: 'Email is required.' });

      const user = await prisma.user.findUnique({ where: { email } });
      if (user && !user.emailVerified) {
        try {
          const issued = await issueEmailCode(user.id, email, 'EMAIL_VERIFY');
          if (issued.code) await sendVerificationCode(email, user.name, issued.code);
        } catch (err) {
          request.log.error({ err }, 'Failed to resend verification email');
        }
      }
      // Generic response: never reveal whether the account exists.
      return { ok: true };
    },
  );

  // Verify an email+password pair and return an API access token. Unverified
  // accounts are rejected with a distinct error so the UI can offer the code
  // entry / resend flow.
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
        // Same message for unknown user and wrong password - no account probing.
        return reply.code(401).send({ error: 'Invalid email or password.' });
      }

      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) {
        return reply.code(401).send({ error: 'Invalid email or password.' });
      }

      if (!user.emailVerified) {
        return reply.code(401).send({ error: 'EMAIL_NOT_VERIFIED' });
      }

      const token = await signAccessToken(user);
      return {
        token,
        user: { id: user.id, email: user.email, name: user.name, admin: user.admin },
      };
    },
  );

  // Start password recovery. Always answers ok to prevent account probing.
  app.post(
    '/auth/forgot-password',
    { config: { rateLimit: { max: 5, timeWindow: 60_000 } } },
    async (request, reply) => {
      const body = (request.body ?? {}) as { email?: string };
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!email) return reply.code(400).send({ error: 'Email is required.' });

      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        try {
          const issued = await issueEmailCode(user.id, email, 'PASSWORD_RESET');
          if (issued.code) await sendPasswordResetCode(email, user.name, issued.code);
        } catch (err) {
          request.log.error({ err }, 'Failed to send password reset email');
        }
      }
      return { ok: true };
    },
  );

  // Complete password recovery with the emailed code and a new password.
  app.post(
    '/auth/reset-password',
    { config: { rateLimit: { max: 10, timeWindow: 60_000 } } },
    async (request, reply) => {
      const body = (request.body ?? {}) as { email?: string; code?: string; newPassword?: string };
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const code = typeof body.code === 'string' ? body.code.trim() : '';
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

      if (!email || !code || !newPassword) {
        return reply.code(400).send({ error: 'Email, code and a new password are required.' });
      }
      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        return reply
          .code(400)
          .send({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
      }

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return reply.code(400).send({ error: 'Invalid code.' });

      const result = await consumeEmailCode(email, 'PASSWORD_RESET', code);
      if (result !== 'ok') {
        const message =
          result === 'expired'
            ? 'That code has expired. Request a new one.'
            : result === 'attempts_exceeded'
              ? 'Too many incorrect attempts. Request a new code.'
              : 'Invalid code.';
        return reply.code(400).send({ error: message });
      }

      const passwordHash = await hashPassword(newPassword);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          // A reset also proves mailbox control; mark verified if it somehow
          // wasn't (e.g. account created before verification existed).
          emailVerified: user.emailVerified ?? new Date(),
        },
      });
      return { ok: true };
    },
  );
};

export { authRoutes };
