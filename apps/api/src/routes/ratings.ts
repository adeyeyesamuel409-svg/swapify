import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { SwapStatus, prisma } from '@swapify/db';
import { HttpError } from '../services/swaps.js';
import { notify } from '../services/notifications.js';

const rateSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
  body: {
    type: 'object',
    required: ['score'],
    properties: {
      score: { type: 'integer', minimum: 1, maximum: 5 },
      comment: { type: 'string', maxLength: 500 },
    },
  },
} as const;

const userParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
} as const;

const swapParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
} as const;

const ratingRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Ratings on a specific swap (visible to the participants).
  app.get('/swaps/:id/ratings', { preHandler: [app.authenticate], schema: swapParamsSchema }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const swap = await prisma.swap.findUnique({ where: { id } });
    if (!swap || (swap.offeringUserId !== user.id && swap.requestedUserId !== user.id)) {
      return reply.code(404).send({ error: 'Swap not found' });
    }

    const ratings = await prisma.rating.findMany({
      where: { swapId: id },
      include: { rater: { select: { id: true, name: true, imageUrl: true } } },
    });

    return { ratings };
  });

  // Rate the other party on a completed swap. One rating per rater per swap
  // (upsert so re-submitting updates instead of duplicating).
  app.post('/swaps/:id/rating', { preHandler: [app.authenticate], schema: rateSchema }, async (request) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { score, comment } = request.body as { score: number; comment?: string };

    const swap = await prisma.swap.findUnique({ where: { id } });
    if (!swap || (swap.offeringUserId !== user.id && swap.requestedUserId !== user.id)) {
      throw new HttpError(404, 'Swap not found');
    }
    if (swap.status !== SwapStatus.COMPLETED) {
      throw new HttpError(409, 'You can only rate a swap after it is completed');
    }

    const rateeId = swap.offeringUserId === user.id ? swap.requestedUserId : swap.offeringUserId;

    const rating = await prisma.rating.upsert({
      where: { swapId_raterId: { swapId: id, raterId: user.id } },
      create: { swapId: id, raterId: user.id, rateeId, score, comment: comment ?? null },
      update: { score, comment: comment ?? null },
      include: { rater: { select: { id: true, name: true, imageUrl: true } } },
    });

    await notify(rateeId, 'RATING', `${user.name} rated your swap ${score} stars`, id);

    return { rating };
  });

  // Public: ratings a user has received, plus the average.
  app.get('/users/:id/ratings', { schema: userParamsSchema }, async (request) => {
    const { id } = request.params as { id: string };

    const [ratings, aggregate] = await Promise.all([
      prisma.rating.findMany({
        where: { rateeId: id },
        include: { rater: { select: { id: true, name: true, imageUrl: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.rating.aggregate({
        where: { rateeId: id },
        _avg: { score: true },
        _count: true,
      }),
    ]);

    return { ratings, averageScore: aggregate._avg.score, total: aggregate._count };
  });
};

export { ratingRoutes };
