import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { getUserBalance, getUserBalanceEntries } from '../services/balance.js';

// ---------------------------------------------------------------------------
// User balance routes — authenticated, current-user only.
//
// Internal balance/settlement architecture only. External withdrawals and
// payment-provider disbursements are intentionally disabled pending business,
// legal and FCA review.
// ---------------------------------------------------------------------------

const balanceRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // GET /users/me/balance — current user's balance summary
  app.get('/users/me/balance', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user!.id;
    const balance = await getUserBalance(userId);
    return balance;
  });

  // GET /users/me/balance/transactions — current user's paginated transaction history
  app.get('/users/me/balance/transactions', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user!.id;
    const { cursor, limit } = request.query as { cursor?: string; limit?: string };
    const result = await getUserBalanceEntries(userId, {
      cursor,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return result;
  });
};

export { balanceRoutes };
