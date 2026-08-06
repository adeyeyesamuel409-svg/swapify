import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { prisma } from '@swapify/db';

const healthRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/', async () => ({
    name: 'Swapify API',
    version: '0.1.0',
    docs: 'Open the web app at http://localhost:3000',
    endpoints: ['/health', '/items', '/items/:id', '/auth/me'],
  }));

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
