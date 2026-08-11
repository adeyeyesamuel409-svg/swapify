import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { AdminRole, ItemStatus, PaymentStatus, SwapStatus, prisma } from '@swapify/db';
import { HttpError } from '../services/swaps.js';

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

    const [users, items, swaps, activeSwaps, paidSwaps, revenue] = await Promise.all([
      prisma.user.count(),
      prisma.item.count(),
      prisma.swap.count(),
      prisma.swap.count({
        where: { status: { in: [SwapStatus.REQUESTED, SwapStatus.AGREED, SwapStatus.PAID, SwapStatus.SHIPPED] } },
      }),
      prisma.swap.count({ where: { status: SwapStatus.PAID } }),
      prisma.payment.aggregate({
        where: { status: PaymentStatus.PAID },
        _sum: { feePence: true },
      }),
    ]);

    return {
      stats: {
        users,
        items,
        swaps,
        activeSwaps,
        paidSwaps,
        // Aggregate sums come back as BigInt from Prisma; coerce to a plain
        // number of pence so Fastify's JSON serializer can emit them.
        totalFeesPence: Number(revenue._sum.feePence ?? 0n),
      },
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
        _count: { select: { items: true, swapsOffered: true, swapsRequested: true, paymentsMade: true } },
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
};

export { adminRoutes };
