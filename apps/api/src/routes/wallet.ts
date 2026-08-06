import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '@swapify/db';

const walletRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Returns the caller's wallet and its recent ledger history.
  app.get('/wallet', { preHandler: [app.authenticate] }, async (request, reply) => {
    const wallet = await prisma.wallet.findUnique({
      where: { userId: request.user!.id },
    });

    if (!wallet) {
      return reply.code(404).send({ error: 'Wallet not found' });
    }

    const transactions = await prisma.tokenTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return { wallet, transactions };
  });
};

export { walletRoutes };
