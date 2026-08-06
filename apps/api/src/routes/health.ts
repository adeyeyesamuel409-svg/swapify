import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '@swapify/db';

const healthRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/health', async () => {
    let database = 'up';

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      app.log.error(err);
      database = 'down';
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      services: { api: 'up', database },
      timestamp: new Date().toISOString(),
    };
  });
};

export { healthRoutes };
