import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import rateLimit from 'fastify-rate-limit';
import * as realMcpAuth from '../../middleware/mcpAuth.ts';
import * as realRateLimit from '../../utils/rate-limit.ts';

const mcpAuthSnap = { ...realMcpAuth };
const rateLimitSnap = { ...realRateLimit };

const authenticateMcpTokenMock = async (request: FastifyRequest, reply: FastifyReply) => {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer praetor_mcp_')) {
    return reply.code(401).send({ error: 'MCP token required' });
  }
};

let routePlugin: typeof import('../../routes/mcp.ts').default;
let testApp: FastifyInstance;

beforeAll(async () => {
  // Override the route's max so we can prove the per-route limit triggers without
  // sending 600+ requests. The real STANDARD_ROUTE_RATE_LIMIT (600/min) is verified
  // separately by reading the route source — this test just proves the route is
  // actually wired into the rate-limiter rather than relying only on the global bucket.
  mock.module('../../utils/rate-limit.ts', () => ({
    ...rateLimitSnap,
    STANDARD_ROUTE_RATE_LIMIT: { max: 2, timeWindow: '1 minute' },
  }));
  mock.module('../../middleware/mcpAuth.ts', () => ({
    ...mcpAuthSnap,
    authenticateMcpToken: authenticateMcpTokenMock,
  }));
  routePlugin = (await import('../../routes/mcp.ts')).default;
});

afterAll(async () => {
  mock.module('../../middleware/mcpAuth.ts', () => mcpAuthSnap);
  mock.module('../../utils/rate-limit.ts', () => rateLimitSnap);
  if (testApp) await testApp.close();
});

beforeEach(async () => {
  if (testApp) await testApp.close();
  const app = Fastify({ logger: false });
  await app.register(rateLimit, {
    global: false,
  });
  await app.register(routePlugin, { prefix: '/api/mcp' });
  await app.ready();
  testApp = app;
});

const injectMcpRequest = (app: FastifyInstance) =>
  app.inject({
    method: 'POST',
    url: '/api/mcp',
    headers: {
      authorization: 'Bearer praetor_mcp_test',
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-06-18',
    },
    payload: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
  });

describe('POST /api/mcp rate limiting', () => {
  test('returns 429 once the per-route ceiling is exhausted', async () => {
    const first = await injectMcpRequest(testApp);
    const second = await injectMcpRequest(testApp);
    const third = await injectMcpRequest(testApp);

    // The first two requests are allowed (whatever the MCP handler returns is fine —
    // we're not exercising the MCP server, only the rate-limiter); the third is
    // throttled by the per-route ceiling.
    expect(first.statusCode).not.toBe(429);
    expect(second.statusCode).not.toBe(429);
    expect(third.statusCode).toBe(429);
  });
});
