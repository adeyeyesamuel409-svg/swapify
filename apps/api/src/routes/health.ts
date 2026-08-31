import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '@swapify/db';

const healthRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/health', async (_request, reply) => {
    let database = 'up';

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      app.log.error(err, 'Health check: database probe failed');
      database = 'down';
    }

    const healthy = database === 'up';

    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      services: { api: 'up', database },
      timestamp: new Date().toISOString(),
    });
  });
};

export { healthRoutes };
