// Wraps the auth middleware so that under Fastify's `inject()` an early `reply.send()` actually
// halts the chain. Two quirks compound: the real middleware does `return reply.send(...)` so
// wrap-thenable.js re-sends the reply, and `reply.sent` lags `raw.headersSent` until the next
// tick so subsequent hooks and the route handler still run. Hijacking after each hook flips
// `reply.sent` synchronously, which Fastify treats as a hard stop.
//
// Used in route tests via `installAuthMiddlewareMock()` in `beforeAll`.

import { mock } from 'bun:test';
import type { FastifyReply, FastifyRequest } from 'fastify';
import * as realMiddleware from '../../middleware/auth.ts';

const middlewareSnap = { ...realMiddleware };

const wrapHook = (hook: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) => {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (reply.sent || reply.raw.headersSent) return;
    await hook(req, reply);
    if (reply.raw.headersSent && !reply.sent) reply.hijack();
  };
};

export const installAuthMiddlewareMock = () => {
  mock.module('../../middleware/auth.ts', () => ({
    ...middlewareSnap,
    authenticateToken: wrapHook(middlewareSnap.authenticateToken),
    requireRole: (...args: Parameters<typeof middlewareSnap.requireRole>) =>
      wrapHook(middlewareSnap.requireRole(...args)),
    requirePermission: (...args: Parameters<typeof middlewareSnap.requirePermission>) =>
      wrapHook(middlewareSnap.requirePermission(...args)),
    requireAnyPermission: (...args: Parameters<typeof middlewareSnap.requireAnyPermission>) =>
      wrapHook(middlewareSnap.requireAnyPermission(...args)),
  }));
};

export const restoreAuthMiddlewareMock = () => {
  mock.module('../../middleware/auth.ts', () => middlewareSnap);
};
