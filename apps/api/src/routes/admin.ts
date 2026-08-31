import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { AdminRole, ItemStatus, PaymentStatus, SwapStatus, prisma } from '@swapify/db';
import { HttpError } from '../services/swaps.js';
import { reconcileValueGaps } from '../services/value-gap.js';
import { getBalanceStats, getUserBalanceAdmin, reconcileUserBalance } from '../services/balance.js';

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

// Role hierarchy: SUPER_ADMIN > MODERATOR > SUPPORT
const ROLE_HIERARCHY: Record<AdminRole, number> = {
  SUPER_ADMIN: 3,
  MODERATOR: 2,
  SUPPORT: 1,
};

function requireRole(user: { admin: { role: AdminRole } | null }, minimum: AdminRole): void {
  if (!user.admin) {
    throw new HttpError(403, 'Admin access required');
  }
  if ((ROLE_HIERARCHY[user.admin.role] ?? 0) < ROLE_HIERARCHY[minimum]) {
    throw new HttpError(403, `${minimum} role or higher required`);
  }
}

function requireAdmin(user: { admin: { role: AdminRole } | null }): void {
  requireRole(user, 'SUPPORT');
}

function requireModerator(user: { admin: { role: AdminRole } | null }): void {
  requireRole(user, 'MODERATOR');
}

function requireSuperAdmin(user: { admin: { role: AdminRole } | null }): void {
  requireRole(user, 'SUPER_ADMIN');
}

const adminRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/admin/stats', { preHandler: [app.authenticate] }, async (request) => {
    requireAdmin(request.user!);

    const [users, items, swaps, activeSwaps, paidSwaps, revenue, valueGapStats] = await Promise.all([
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
      prisma.valueGap.groupBy({
        by: ['state'],
        _count: { id: true },
        _sum: { valueGapPence: true },
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
        // Value-gap ledger summary
        valueGaps: valueGapStats.map((vg) => ({
          state: vg.state,
          count: vg._count.id,
          totalValueGapPence: Number(vg._sum.valueGapPence ?? 0n),
        })),
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
    requireModerator(request.user!);

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

  // Value-gap reconciliation: force-reconcile stuck value gaps.
  // Admin-only endpoint for manual intervention.
  app.post('/admin/value-gaps/reconcile', { preHandler: [app.authenticate] }, async (request) => {
    requireModerator(request.user!);
    const reconciled = await reconcileValueGaps();
    return { reconciled };
  });

  // View value-gap records for a specific swap (admin only).
  app.get('/admin/swaps/:id/value-gap', {
    preHandler: [app.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    requireAdmin(request.user!);
    const { id } = request.params as { id: string };

    const valueGap = await prisma.valueGap.findUnique({
      where: { swapId: id },
      include: {
        payer: { select: { id: true, name: true, email: true } },
        recipient: { select: { id: true, name: true, email: true } },
        payment: { select: { id: true, amountPence: true, feePence: true, totalPence: true, status: true } },
      },
    });

    if (!valueGap) {
      return reply.code(404).send({ error: 'No value-gap record found for this swap' });
    }

    return { valueGap };
  });

  // Balance stats: aggregate view of all user balances (admin only).
  app.get('/admin/balances/stats', { preHandler: [app.authenticate] }, async (request) => {
    requireAdmin(request.user!);
    const stats = await getBalanceStats();
    return { stats };
  });

  // Admin lookup for a specific user's balance and recent entries.
  app.get('/admin/balances/user/:userId', {
    preHandler: [app.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    requireAdmin(request.user!);
    const { userId } = request.params as { userId: string };

    const result = await getUserBalanceAdmin(userId);
    if (!result.account) {
      return reply.code(404).send({ error: 'No balance account found for this user' });
    }
    return result;
  });

  // Balance reconciliation: check a user's ledger vs account balance consistency.
  app.get('/admin/balances/reconcile/:userId', {
    preHandler: [app.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['userId'],
        properties: { userId: { type: 'string' } },
      },
    },
  }, async (request) => {
    requireModerator(request.user!);
    const { userId } = request.params as { userId: string };
    const result = await reconcileUserBalance(userId);
    return result;
  });
};

export { adminRoutes, requireAdmin, requireModerator, requireSuperAdmin };
