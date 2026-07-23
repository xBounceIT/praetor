import { describe, expect, test } from 'bun:test';
import Fastify from 'fastify';
import rateLimit from 'fastify-rate-limit';
import {
  AI_REPORTING_CHAT_RATE_LIMIT,
  GLOBAL_RATE_LIMIT,
  LOGIN_RATE_LIMIT,
  STANDARD_ROUTE_RATE_LIMIT,
} from '../../utils/rate-limit.ts';

describe('GLOBAL_RATE_LIMIT', () => {
  test('has the documented max and timeWindow', () => {
    expect(GLOBAL_RATE_LIMIT.max).toBe(3000);
    expect(GLOBAL_RATE_LIMIT.timeWindow).toBe('1 minute');
  });
});

describe('STANDARD_ROUTE_RATE_LIMIT', () => {
  test('has the documented max and timeWindow', () => {
    expect(STANDARD_ROUTE_RATE_LIMIT.max).toBe(600);
    expect(STANDARD_ROUTE_RATE_LIMIT.timeWindow).toBe('1 minute');
  });
});

describe('LOGIN_RATE_LIMIT', () => {
  test('has the documented max and timeWindow', () => {
    expect(LOGIN_RATE_LIMIT.max).toBe(30);
    expect(LOGIN_RATE_LIMIT.timeWindow).toBe('15 minutes');
  });
});

describe('AI_REPORTING_CHAT_RATE_LIMIT', () => {
  test('blocks the eleventh request across routes sharing one limiter', async () => {
    const app = Fastify({ logger: false });
    await app.register(rateLimit, { global: false });
    app.addHook('onRequest', async (request) => {
      request.user = {
        id: 'user-1',
        name: 'Alice',
        username: 'alice',
        role: 'manager',
        avatarInitials: 'AL',
        permissions: ['reports.ai_reporting.create'],
      };
    });
    const chatRateLimit = app.rateLimit(AI_REPORTING_CHAT_RATE_LIMIT);
    app.post('/send', { onRequest: [chatRateLimit] }, async () => ({ ok: true }));
    app.post('/regenerate', { onRequest: [chatRateLimit] }, async () => ({ ok: true }));

    try {
      for (let requestNumber = 0; requestNumber < 10; requestNumber++) {
        const response = await app.inject({
          method: 'POST',
          url: requestNumber % 2 === 0 ? '/send' : '/regenerate',
        });
        expect(response.statusCode).toBe(200);
      }

      const blocked = await app.inject({ method: 'POST', url: '/regenerate' });
      expect(blocked.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });
});

describe('rate-limit invariants', () => {
  test('login is the strictest', () => {
    expect(LOGIN_RATE_LIMIT.max).toBeLessThan(STANDARD_ROUTE_RATE_LIMIT.max);
    expect(STANDARD_ROUTE_RATE_LIMIT.max).toBeLessThan(GLOBAL_RATE_LIMIT.max);
  });

  test('all configs expose a numeric max', () => {
    for (const cfg of [GLOBAL_RATE_LIMIT, STANDARD_ROUTE_RATE_LIMIT, LOGIN_RATE_LIMIT]) {
      expect(typeof cfg.max).toBe('number');
      expect(cfg.max).toBeGreaterThan(0);
    }
  });

  test('all configs expose a non-empty timeWindow string', () => {
    for (const cfg of [GLOBAL_RATE_LIMIT, STANDARD_ROUTE_RATE_LIMIT, LOGIN_RATE_LIMIT]) {
      expect(typeof cfg.timeWindow).toBe('string');
      expect(cfg.timeWindow.length).toBeGreaterThan(0);
    }
  });
});
