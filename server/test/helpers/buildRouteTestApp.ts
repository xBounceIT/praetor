import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';

// Why no `@fastify/rate-limit`: the plugin's onResponse hook double-writes after
// `authMiddlewareMock` hijacks an early-401/403 reply. Decorating `rateLimit` as a no-op gives
// route files the decorator they expect without that hook.
export const buildRouteTestApp = async (
  routePlugin: FastifyPluginAsync,
  prefix: string,
): Promise<FastifyInstance> => {
  const app = Fastify({ logger: false });
  app.decorate('rateLimit', () => async () => {});
  await app.register(routePlugin, { prefix });
  await app.ready();
  return app;
};
