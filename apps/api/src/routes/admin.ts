import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { AdminRole, ItemStatus, SwapStatus, TransactionDirection, TransactionType, prisma } from '@swapify/db';
import { HttpError } from '../services/swaps.js';
import { applyLedgerEntry } from '../services/ledger.js';
import { tokensToMicroTokens } from '@swapify/shared';

const statusSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
  body: {
    type: 'object',
    required: ['status'],
    properties: {
      status: { type: 'string', enum: Object.values(ItemStatus) },
    },
  },
} as const;

const creditSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
  body: {
    type: 'object',
    required: ['tokens'],
    properties: {
      tokens: { type: 'number', exclusiveMinimum: 0 },
      note: { type: 'string', maxLength: 200 },
    },
  },
} as const;

// Rejects non-admins. request.user.admin is populated when the User row has a
// matching Admin row (see /auth/me).
function requireAdmin(user: { admin: { role: AdminRole } | null }): void {
  if (!user.admin) {
    throw new HttpError(403, 'Admin access required');
  }
}

const adminRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/admin/stats', { preHandler: [app.authenticate] }, async (request) => {
    requireAdmin(request.user!);

    const [users, items, swaps, activeSwaps, escrowed] = await Promise.all([
      prisma.user.count(),
      prisma.item.count(),
      prisma.swap.count(),
      prisma.swap.count({
        where: { status: { in: [SwapStatus.REQUESTED, SwapStatus.AGREED, SwapStatus.ESCROWED, SwapStatus.SHIPPED] } },
      }),
      prisma.escrowHold.aggregate({
        where: { status: 'HELD' },
        _sum: { amountMicroTokens: true },
      }),
    ]);

    return {
      stats: { users, items, swaps, activeSwaps, escrowedMicroTokens: escrowed._sum.amountMicroTokens ?? 0n },
    };
  });

  app.get('/admin/users', { preHandler: [app.authenticate] }, async (request) => {
    requireAdmin(request.user!);

    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        admin: { select: { role: true } },
        wallet: { select: { balanceMicroTokens: true } },
        _count: { select: { items: true, swapsOffered: true, swapsRequested: true } },
      },
    });

    return { users };
  });

  app.get('/admin/listings', { preHandler: [app.authenticate] }, async (request) => {
    requireAdmin(request.user!);

    const { status } = request.query as { status?: ItemStatus };
    const items = await prisma.item.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        images: { orderBy: { position: 'asc' as const } },
      },
    });

    return { items };
  });

  // Force an item to a status (e.g. restore an ACTIVE item, or hide a problem listing).
  app.post('/admin/items/:id/status', { preHandler: [app.authenticate], schema: statusSchema }, async (request, reply) => {
    requireAdmin(request.user!);

    const { id } = request.params as { id: string };
    const { status } = request.body as { status: ItemStatus };

    const existing = await prisma.item.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'Item not found' });
    }

    const item = await prisma.item.update({
      where: { id },
      data: { status },
      include: { owner: { select: { id: true, name: true, email: true } } },
    });
    return { item };
  });

  // Manual token adjustment to a user's wallet (recorded as an ADJUSTMENT).
  app.post('/admin/users/:id/credit', { preHandler: [app.authenticate], schema: creditSchema }, async (request, reply) => {
    requireAdmin(request.user!);

    const { id } = request.params as { id: string };
    const { tokens, note } = request.body as { tokens: number; note?: string };

    const user = await prisma.user.findUnique({
      where: { id },
      include: { wallet: true },
    });
    if (!user?.wallet) {
      return reply.code(404).send({ error: 'User or wallet not found' });
    }

    const tx = await applyLedgerEntry({
      walletId: user.wallet.id,
      type: TransactionType.ADJUSTMENT,
      direction: TransactionDirection.CREDIT,
      amountMicroTokens: tokensToMicroTokens(tokens),
      note: note ?? 'Admin adjustment',
    });

    return { tx };
  });
};

export { adminRoutes };
