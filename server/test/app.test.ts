import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import buildApp from '../app.ts';

describe('buildApp route registration', () => {
  let app: FastifyInstance;
  let routeTree: string;

  // buildApp wires every Fastify plugin and route module, which can take longer
  // than Bun's 5s default when the test runner is warming up.
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    routeTree = app.printRoutes({ commonPrefix: false });
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  // Regression guard for the duplicate `supplierQuotesRoutes` registration that
  // mounted the module at both `/api/sales/supplier-quotes` and `/api/supplier-quotes`,
  // causing side effects (rate limiting, audit logs) to run twice.
  test('mounts supplier-quotes only under the canonical /api/sales prefix', () => {
    const salesMatches = routeTree.match(/\/api\/sales\/supplier-quotes \(/g) ?? [];
    const legacyMatches = routeTree.match(/\/api\/supplier-quotes \(/g) ?? [];

    expect(salesMatches.length).toBe(1);
    expect(legacyMatches.length).toBe(0);
  });
});
