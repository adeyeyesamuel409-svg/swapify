import { FastifyInstance, FastifyPluginAsync } from 'fastify';

const authRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Returns the current user (auto-created on first login).
  app.get('/auth/me', { preHandler: [app.authenticate] }, async (request) => {
    return { user: request.user };
  });
};

export { authRoutes };
