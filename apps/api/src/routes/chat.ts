import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '@swapify/db';
import { HttpError } from '../services/swaps.js';
import { notify } from '../services/notifications.js';

const swapParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
} as const;

const sendSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
  body: {
    type: 'object',
    required: ['body'],
    properties: {
      body: { type: 'string', minLength: 1, maxLength: 2000 },
    },
  },
} as const;

const chatRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Chat history for a swap. Only the two participants can see it.
  app.get('/swaps/:id/messages', { preHandler: [app.authenticate], schema: swapParamsSchema }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const swap = await prisma.swap.findUnique({ where: { id } });
    if (!swap || (swap.offeringUserId !== user.id && swap.requestedUserId !== user.id)) {
      return reply.code(404).send({ error: 'Swap not found' });
    }

    const messages = await prisma.message.findMany({
      where: { swapId: id },
      include: { sender: { select: { id: true, name: true, imageUrl: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return { messages };
  });

  // Send a chat message on a swap.
  app.post('/swaps/:id/messages', { preHandler: [app.authenticate], schema: sendSchema }, async (request) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { body } = request.body as { body: string };

    const swap = await prisma.swap.findUnique({ where: { id } });
    if (!swap || (swap.offeringUserId !== user.id && swap.requestedUserId !== user.id)) {
      throw new HttpError(404, 'Swap not found');
    }

    const message = await prisma.message.create({
      data: { swapId: id, senderId: user.id, body },
      include: { sender: { select: { id: true, name: true, imageUrl: true } } },
    });

    const otherParty = swap.offeringUserId === user.id ? swap.requestedUserId : swap.offeringUserId;
    await notify(otherParty, 'MESSAGE', `New message from ${user.name}`, swap.id);

    return { message };
  });
};

export { chatRoutes };
