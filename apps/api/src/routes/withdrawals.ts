import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  requestWithdrawal,
  getWithdrawalStatus,
  cancelWithdrawal,
  getUserWithdrawals,
  WithdrawalError,
  type WithdrawalErrorCode,
} from '../services/withdrawal.js';

// ---------------------------------------------------------------------------
// Withdrawal routes — authenticated, current-user only.
//
// Endpoints:
//   POST /users/me/withdrawals          — request a withdrawal
//   GET  /users/me/withdrawals          — list user's withdrawals
//   GET  /users/me/withdrawals/:id      — get withdrawal status
//   POST /users/me/withdrawals/:id/cancel — cancel pending withdrawal
// ---------------------------------------------------------------------------

const withdrawalRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // POST /users/me/withdrawals — request a withdrawal
  // P2 #11: Dedicated rate limit — 10 per minute per user (stricter than
  // the global 200/min). Withdrawals are high-value operations that require
  // tighter abuse protection.
  app.post('/users/me/withdrawals', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 10, timeWindow: 60_000 } },
  }, async (request, reply) => {
    const userId = request.user!.id;
    const body = request.body as { amountPence?: number };

    if (!body.amountPence || typeof body.amountPence !== 'number') {
      return reply.code(400).send({ error: 'amountPence is required and must be a number' });
    }

    if (!Number.isInteger(body.amountPence) || body.amountPence <= 0) {
      return reply.code(400).send({ error: 'amountPence must be a positive integer (GBP pence)' });
    }

    try {
      const result = await requestWithdrawal({ userId, amountPence: body.amountPence });
      return reply.code(201).send(result);
    } catch (err) {
      if (err instanceof WithdrawalError) {
        const statusMap: Partial<Record<WithdrawalErrorCode, number>> = {
          WITHDRAWAL_NOT_FOUND: 404,
          USER_NOT_FOUND: 404,
          CONNECT_ACCOUNT_REQUIRED: 404,
          PAYOUT_METHOD_REQUIRED: 404,
          INSUFFICIENT_BALANCE: 400,
          WITHDRAWAL_LIMIT_EXCEEDED: 429,
          PAYOUTS_DISABLED: 403,
          ACCOUNT_NOT_ACTIVE: 409,
          MINIMUM_WITHDRAWAL: 400,
          MAXIMUM_WITHDRAWAL: 400,
          WITHDRAWAL_FAILED: 500,
          WITHDRAWAL_ALREADY_PROCESSING: 409,
        };
        return reply.code(statusMap[err.code] ?? 500).send({ error: err.message, code: err.code });
      }
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // GET /users/me/withdrawals — list user's withdrawals
  app.get('/users/me/withdrawals', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user!.id;
    const query = request.query as { cursor?: string; limit?: number };
    return getUserWithdrawals(userId, {
      cursor: query.cursor,
      limit: query.limit,
    });
  });

  // GET /users/me/withdrawals/:id — get withdrawal status
  app.get('/users/me/withdrawals/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user!.id;
    const { id } = request.params as { id: string };

    try {
      return await getWithdrawalStatus(userId, id);
    } catch (err) {
      if (err instanceof WithdrawalError) {
        const status = err.code === 'WITHDRAWAL_NOT_FOUND' ? 404 : 500;
        return reply.code(status).send({ error: err.message, code: err.code });
      }
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // POST /users/me/withdrawals/:id/cancel — cancel pending withdrawal
  app.post('/users/me/withdrawals/:id/cancel', { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = request.user!.id;
    const { id } = request.params as { id: string };

    try {
      return await cancelWithdrawal(userId, id);
    } catch (err) {
      if (err instanceof WithdrawalError) {
        const statusMap: Partial<Record<WithdrawalErrorCode, number>> = {
          WITHDRAWAL_NOT_FOUND: 404,
          WITHDRAWAL_ALREADY_PROCESSING: 409,
        };
        return reply.code(statusMap[err.code] ?? 500).send({ error: err.message, code: err.code });
      }
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
};

export { withdrawalRoutes };
