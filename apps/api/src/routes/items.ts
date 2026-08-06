import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Category, Condition, ItemStatus, prisma } from '@swapify/db';
import { tokensToMicroTokens } from '@swapify/shared';

const categoryValues = Object.values(Category);
const conditionValues = Object.values(Condition);

const itemParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
} as const;

const createItemSchema = {
  body: {
    type: 'object',
    required: ['title', 'description', 'category', 'condition', 'valueTokens'],
    properties: {
      title: { type: 'string', minLength: 3, maxLength: 120 },
      description: { type: 'string', minLength: 10, maxLength: 4000 },
      category: { type: 'string', enum: categoryValues },
      condition: { type: 'string', enum: conditionValues },
      // Value in whole tokens (fractions allowed, e.g. 12.5).
      valueTokens: { type: 'number', exclusiveMinimum: 0 },
      // Image URLs for now; S3 upload arrives in Sprint 8.
      images: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    },
  },
} as const;

const updateItemSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
  body: {
    type: 'object',
    required: [],
    properties: {
      title: { type: 'string', minLength: 3, maxLength: 120 },
      description: { type: 'string', minLength: 10, maxLength: 4000 },
      category: { type: 'string', enum: categoryValues },
      condition: { type: 'string', enum: conditionValues },
      valueTokens: { type: 'number', exclusiveMinimum: 0 },
      status: { type: 'string', enum: Object.values(ItemStatus) },
      images: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    },
  },
} as const;

const listItemsSchema = {
  querystring: {
    type: 'object',
    properties: {
      category: { type: 'string', enum: categoryValues },
      condition: { type: 'string', enum: conditionValues },
      q: { type: 'string', maxLength: 200 },
      ownerId: { type: 'string' },
      page: { type: 'integer', minimum: 1, default: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    },
  },
} as const;

type ListItemQuery = {
  category?: Category;
  condition?: Condition;
  q?: string;
  ownerId?: string;
  page: number;
  pageSize: number;
};

const itemInclude = {
  images: { orderBy: { position: 'asc' as const } },
  owner: { select: { id: true, name: true, imageUrl: true } },
};

const itemsRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/items', { schema: listItemsSchema }, async (request) => {
    const { category, condition, q, ownerId, page, pageSize } = request.query as ListItemQuery;

    const where: Record<string, unknown> = {};

    // Everyone sees only active listings, unless we're listing a specific owner's items.
    if (ownerId) {
      where.ownerId = ownerId;
    } else {
      where.status = ItemStatus.ACTIVE;
    }
    if (category) where.category = category;
    if (condition) where.condition = condition;
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.item.findMany({
        where,
        include: itemInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.item.count({ where }),
    ]);

    return { items, total, page, pageSize };
  });

  app.get('/items/me', { preHandler: [app.authenticate] }, async (request) => {
    const user = request.user!;

    const items = await prisma.item.findMany({
      where: { ownerId: user.id, status: { not: ItemStatus.DELETED } },
      include: itemInclude,
      orderBy: { createdAt: 'desc' },
    });

    return { items, total: items.length, page: 1, pageSize: items.length };
  });

  app.get('/items/:id', { schema: itemParamsSchema }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const item = await prisma.item.findUnique({
      where: { id },
      include: itemInclude,
    });

    if (!item || item.status === ItemStatus.DELETED) {
      return reply.code(404).send({ error: 'Item not found' });
    }

    return { item };
  });

  app.post('/items', { preHandler: [app.authenticate], schema: createItemSchema }, async (request) => {
    const user = request.user!;
    const body = request.body as {
      title: string;
      description: string;
      category: Category;
      condition: Condition;
      valueTokens: number;
      images?: string[];
    };

    const item = await prisma.item.create({
      data: {
        ownerId: user.id,
        title: body.title,
        description: body.description,
        category: body.category,
        condition: body.condition,
        valueMicroTokens: tokensToMicroTokens(body.valueTokens),
        images: {
          create: (body.images ?? []).map((url, index) => ({ url, position: index })),
        },
      },
      include: itemInclude,
    });

    return { item };
  });

  app.patch('/items/:id', { preHandler: [app.authenticate], schema: updateItemSchema }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const body = request.body as {
      title?: string;
      description?: string;
      category?: Category;
      condition?: Condition;
      valueTokens?: number;
      status?: ItemStatus;
      images?: string[];
    };

    const existing = await prisma.item.findUnique({ where: { id } });
    if (!existing || existing.ownerId !== user.id) {
      return reply.code(404).send({ error: 'Item not found' });
    }

    const item = await prisma.$transaction(async (tx) => {
      let updated = await tx.item.update({
        where: { id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.category !== undefined ? { category: body.category } : {}),
          ...(body.condition !== undefined ? { condition: body.condition } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.valueTokens !== undefined
            ? { valueMicroTokens: tokensToMicroTokens(body.valueTokens) }
            : {}),
        },
        include: itemInclude,
      });

      if (body.images !== undefined) {
        await tx.itemImage.deleteMany({ where: { itemId: id } });
        updated = await tx.item.update({
          where: { id },
          data: {
            images: {
              create: body.images.map((url, index) => ({ url, position: index })),
            },
          },
          include: itemInclude,
        });
      }

      return updated;
    });

    return { item };
  });

  app.delete('/items/:id', { preHandler: [app.authenticate], schema: itemParamsSchema }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const existing = await prisma.item.findUnique({ where: { id } });
    if (!existing || existing.ownerId !== user.id) {
      return reply.code(404).send({ error: 'Item not found' });
    }

    // Soft delete keeps historical swaps intact.
    const item = await prisma.item.update({
      where: { id },
      data: { status: ItemStatus.DELETED },
    });

    return { item };
  });
};

export { itemsRoutes };
