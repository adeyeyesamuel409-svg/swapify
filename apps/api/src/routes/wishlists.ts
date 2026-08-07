import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Category, ItemStatus, prisma } from '@swapify/db';
import { tokensToMicroTokens } from '@swapify/shared';

const createSchema = {
  body: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 120 },
      description: { type: 'string', maxLength: 500 },
      category: { type: 'string', enum: Object.values(Category) },
      maxValueTokens: { type: 'number', minimum: 0 },
    },
  },
} as const;

const wishlistParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
} as const;

// Words in a wishlist title too common to match against listing titles.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'i', 'want', 'need', 'looking', 'for', 'to', 'and', 'or', 'of',
  'my', 'me', 'have', 'get', 'wish', 'list', 'swap', 'trade',
]);

function titleKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

const wishlistRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/wishlists', { preHandler: [app.authenticate] }, async (request) => {
    const user = request.user!;
    const wishlists = await prisma.wishlist.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    return { wishlists };
  });

  app.post('/wishlists', { preHandler: [app.authenticate], schema: createSchema }, async (request) => {
    const user = request.user!;
    const { title, description, category, maxValueTokens } = request.body as {
      title: string;
      description?: string;
      category?: Category;
      maxValueTokens?: number;
    };

    const wishlist = await prisma.wishlist.create({
      data: {
        userId: user.id,
        title,
        description: description ?? null,
        category: category ?? null,
        maxValueMicroTokens:
          typeof maxValueTokens === 'number' && maxValueTokens > 0
            ? tokensToMicroTokens(maxValueTokens)
            : null,
      },
    });

    return { wishlist };
  });

  app.delete('/wishlists/:id', { preHandler: [app.authenticate], schema: wishlistParamsSchema }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const existing = await prisma.wishlist.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      return reply.code(404).send({ error: 'Wishlist not found' });
    }

    await prisma.wishlist.delete({ where: { id } });
    return reply.code(204).send();
  });

  // Active listings matching this wishlist: title keywords, optional category
  // and value ceiling. Used to surface "things you want" next to the wishlist.
  app.get('/wishlists/:id/matches', { preHandler: [app.authenticate], schema: wishlistParamsSchema }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const wishlist = await prisma.wishlist.findUnique({ where: { id } });
    if (!wishlist || wishlist.userId !== user.id) {
      return reply.code(404).send({ error: 'Wishlist not found' });
    }

    const keywords = titleKeywords(wishlist.title);
    if (keywords.length === 0) return { matches: [] };

    const items = await prisma.item.findMany({
      where: {
        status: ItemStatus.ACTIVE,
        ...(wishlist.category ? { category: wishlist.category } : {}),
        ...(wishlist.maxValueMicroTokens
          ? { valueMicroTokens: { lte: wishlist.maxValueMicroTokens } }
          : {}),
        OR: keywords.map((word) => ({ title: { contains: word, mode: 'insensitive' } })),
      },
      include: {
        owner: { select: { id: true, name: true, imageUrl: true } },
        images: { orderBy: { position: 'asc' as const } },
      },
      take: 20,
    });

    return { matches: items };
  });
};

export { wishlistRoutes };
