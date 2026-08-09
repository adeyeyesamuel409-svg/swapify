import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { SwapStatus, prisma } from '@swapify/db';

const userParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
} as const;

// Public seller profile: identity, member-since, rating aggregate and number of
// completed swaps. All derived from real data - no fabricated trust signals.
const userRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/users/:id', { schema: userParamsSchema }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, imageUrl: true, bio: true, createdAt: true },
    });

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    const [ratingAggregate, completedSwaps] = await Promise.all([
      prisma.rating.aggregate({
        where: { rateeId: id },
        _avg: { score: true },
        _count: true,
      }),
      prisma.swap.count({
        where: {
          status: SwapStatus.COMPLETED,
          OR: [{ offeringUserId: id }, { requestedUserId: id }],
        },
      }),
    ]);

    return {
      user,
      rating: { averageScore: ratingAggregate._avg.score, total: ratingAggregate._count },
      completedSwaps,
    };
  });
};

export { userRoutes };
