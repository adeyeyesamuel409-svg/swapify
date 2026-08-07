import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '@swapify/db';

const notifParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
} as const;

const notificationRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/notifications', { preHandler: [app.authenticate] }, async (request) => {
    const user = request.user!;
    const notifications = await prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { notifications };
  });

  app.get('/notifications/unread-count', { preHandler: [app.authenticate] }, async (request) => {
    const user = request.user!;
    const count = await prisma.notification.count({
      where: { userId: user.id, read: false },
    });
    return { count };
  });

  app.post('/notifications/:id/read', { preHandler: [app.authenticate], schema: notifParamsSchema }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const existing = await prisma.notification.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      return reply.code(404).send({ error: 'Notification not found' });
    }

    const notification = await prisma.notification.update({
      where: { id },
      data: { read: true },
    });
    return { notification };
  });

  app.post('/notifications/read-all', { preHandler: [app.authenticate] }, async (request) => {
    const user = request.user!;
    const { count } = await prisma.notification.updateMany({
      where: { userId: user.id, read: false },
      data: { read: true },
    });
    return { updated: count };
  });
};

export { notificationRoutes };
