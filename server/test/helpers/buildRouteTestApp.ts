import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import { ajvFormatsPlugin, ajvFormatsPluginOptions } from '../../utils/ajv-formats.ts';
import { PATH_PARAMETER_MAX_LENGTH } from '../../utils/path-segments.ts';

// Why no `@fastify/rate-limit`: the plugin's onResponse hook double-writes after
// `authMiddlewareMock` hijacks an early-401/403 reply. Decorating `rateLimit` as a no-op gives
// route files the decorator they expect without that hook.
//
// AJV is wired with the same `ajv-formats` plugin/options as the real app (server/app.ts) so
// route schemas using `format: 'date-time'` etc. validate identically under test.
export const buildRouteTestApp = async (
  routePlugin: FastifyPluginAsync,
  prefix: string,
  configure?: (app: FastifyInstance) => Promise<void> | void,
): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: false,
    routerOptions: { maxParamLength: PATH_PARAMETER_MAX_LENGTH },
    ajv: {
      customOptions: {},
      plugins: [[ajvFormatsPlugin, ajvFormatsPluginOptions]],
    },
  });
  app.decorate('rateLimit', () => async () => {});
  await configure?.(app);
  await app.register(routePlugin, { prefix });
  await app.ready();
  return app;
};
