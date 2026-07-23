import { afterEach, describe, expect, test } from 'bun:test';
import Fastify from 'fastify';
import rateLimit from 'fastify-rate-limit';
import {
  buildErrorResponseMessage,
  buildRateLimitErrorResponse,
  registerErrorHandler,
} from '../app.ts';

// Lightweight harness that registers the same `registerErrorHandler` used by buildApp(),
// so the production error-handling path is exercised end-to-end without spinning up DB,
// LDAP, or SSO. The production handler reads `process.env.NODE_ENV` directly, so each
// integration test sets/restores it.
const buildTestApp = () => {
  // Capture log lines for assertions about server-side error visibility. Pino accepts a
  // raw stream destination, so we write each JSON log line into an array we can inspect.
  const logLines: string[] = [];
  const captureStream = {
    write(chunk: string) {
      logLines.push(chunk);
    },
  };
  const fastify = Fastify({
    logger: {
      level: 'error',
      stream: captureStream as never,
    },
  });

  registerErrorHandler(fastify);

  fastify.get('/boom-500', async () => {
    throw new Error('Database password is hunter2');
  });

  fastify.get('/boom-400', async () => {
    const err = new Error('Missing required field: email') as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  });

  fastify.get('/boom-503', async () => {
    const err = new Error('Upstream OAuth token leaked') as Error & { statusCode?: number };
    err.statusCode = 503;
    throw err;
  });

  return { fastify, logLines };
};

// Capture both values and presence: assigning `undefined` back to `process.env` stringifies
// it to the literal `'undefined'`, so delete variables that were absent at module load.
const hadOriginalNodeEnv = 'NODE_ENV' in process.env;
const originalNodeEnv = process.env.NODE_ENV;
const hadOriginalExposeInternalErrors = 'EXPOSE_INTERNAL_ERRORS' in process.env;
const originalExposeInternalErrors = process.env.EXPOSE_INTERNAL_ERRORS;
afterEach(() => {
  if (hadOriginalNodeEnv) {
    process.env.NODE_ENV = originalNodeEnv;
  } else {
    delete process.env.NODE_ENV;
  }
  if (hadOriginalExposeInternalErrors) {
    process.env.EXPOSE_INTERNAL_ERRORS = originalExposeInternalErrors;
  } else {
    delete process.env.EXPOSE_INTERNAL_ERRORS;
  }
});

describe('buildErrorResponseMessage', () => {
  test('production + 500: masks message to "Internal server error"', () => {
    const result = buildErrorResponseMessage(new Error('SQL near "FROM" failed'), {
      NODE_ENV: 'production',
    } as NodeJS.ProcessEnv);
    expect(result).toEqual({ statusCode: 500, message: 'Internal server error' });
  });

  test('production + 5xx (503): also masks', () => {
    const err = new Error('Sensitive upstream detail') as Error & { statusCode?: number };
    err.statusCode = 503;
    const result = buildErrorResponseMessage(err, {
      NODE_ENV: 'production',
    } as NodeJS.ProcessEnv);
    expect(result).toEqual({ statusCode: 503, message: 'Internal server error' });
  });

  test('production + 4xx: original message passes through', () => {
    const err = new Error('Invalid email') as Error & { statusCode?: number };
    err.statusCode = 400;
    const result = buildErrorResponseMessage(err, {
      NODE_ENV: 'production',
    } as NodeJS.ProcessEnv);
    expect(result).toEqual({ statusCode: 400, message: 'Invalid email' });
  });

  test('development + 500: masks sensitive details by default', () => {
    const result = buildErrorResponseMessage(new Error('SQL near "FROM" failed'), {
      NODE_ENV: 'development',
    } as NodeJS.ProcessEnv);
    expect(result).toEqual({ statusCode: 500, message: 'Internal server error' });
  });

  test('missing NODE_ENV + 500: masks sensitive details by default', () => {
    const result = buildErrorResponseMessage(
      new Error('SQL near "FROM" failed'),
      {} as NodeJS.ProcessEnv,
    );
    expect(result).toEqual({ statusCode: 500, message: 'Internal server error' });
  });

  test('development + explicit opt-in: exposes detailed 500 messages', () => {
    const result = buildErrorResponseMessage(new Error('SQL near "FROM" failed'), {
      NODE_ENV: 'development',
      EXPOSE_INTERNAL_ERRORS: 'true',
    } as NodeJS.ProcessEnv);
    expect(result).toEqual({ statusCode: 500, message: 'SQL near "FROM" failed' });
  });

  test('production ignores the detailed-error opt-in', () => {
    const result = buildErrorResponseMessage(new Error('SQL near "FROM" failed'), {
      NODE_ENV: 'production',
      EXPOSE_INTERNAL_ERRORS: 'true',
    } as NodeJS.ProcessEnv);
    expect(result).toEqual({ statusCode: 500, message: 'Internal server error' });
  });

  test('falls back to "Internal server error" when the Error has no message', () => {
    const err = new Error('') as Error & { statusCode?: number };
    err.statusCode = 500;
    const result = buildErrorResponseMessage(err, {
      NODE_ENV: 'development',
    } as NodeJS.ProcessEnv);
    expect(result).toEqual({ statusCode: 500, message: 'Internal server error' });
  });
});

describe('buildRateLimitErrorResponse', () => {
  test('returns an Error that preserves the rate-limit status code through the app handler', () => {
    const err = buildRateLimitErrorResponse({} as never, {
      statusCode: 429,
      ban: false,
      after: '1 minute',
      max: 30,
      ttl: 60_000,
    });

    const result = buildErrorResponseMessage(err, {
      NODE_ENV: 'production',
    } as NodeJS.ProcessEnv);

    expect(result).toEqual({ statusCode: 429, message: 'Too many requests' });
  });
});

describe('Fastify error handler integration', () => {
  test('production: a 500 returns the generic message but the real error reaches the log', async () => {
    process.env.NODE_ENV = 'production';
    const { fastify, logLines } = buildTestApp();

    const response = await fastify.inject({ method: 'GET', url: '/boom-500' });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({ error: 'Internal server error' });
    // The original message must still be visible to operators via the server log.
    const allLogs = logLines.join('\n');
    expect(allLogs).toContain('Database password is hunter2');
    expect(allLogs).toContain('Unhandled request error');

    await fastify.close();
  });

  test('production: a 503 also gets the generic message', async () => {
    process.env.NODE_ENV = 'production';
    const { fastify } = buildTestApp();

    const response = await fastify.inject({ method: 'GET', url: '/boom-503' });

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toEqual({ error: 'Internal server error' });

    await fastify.close();
  });

  test('production: a 4xx keeps its original message', async () => {
    process.env.NODE_ENV = 'production';
    const { fastify } = buildTestApp();

    const response = await fastify.inject({ method: 'GET', url: '/boom-400' });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: 'Missing required field: email' });

    await fastify.close();
  });

  test('development masks 5xx error messages unless explicitly enabled', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.EXPOSE_INTERNAL_ERRORS;
    const { fastify } = buildTestApp();

    const response = await fastify.inject({ method: 'GET', url: '/boom-500' });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({ error: 'Internal server error' });

    await fastify.close();
  });

  test('development can explicitly enable detailed 5xx error messages', async () => {
    process.env.NODE_ENV = 'development';
    process.env.EXPOSE_INTERNAL_ERRORS = 'true';
    const { fastify } = buildTestApp();

    const response = await fastify.inject({ method: 'GET', url: '/boom-500' });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({ error: 'Database password is hunter2' });

    await fastify.close();
  });

  test('rate-limit errors preserve 429 through the production error handler', async () => {
    const fastify = Fastify({ logger: false });
    await fastify.register(rateLimit, {
      global: true,
      max: 1,
      timeWindow: '1 minute',
      hook: 'onRequest',
      errorResponseBuilder: buildRateLimitErrorResponse,
    });
    registerErrorHandler(fastify);
    fastify.get('/limited', async () => ({ ok: true }));

    const first = await fastify.inject({ method: 'GET', url: '/limited' });
    const second = await fastify.inject({ method: 'GET', url: '/limited' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(JSON.parse(second.body)).toEqual({ error: 'Too many requests' });

    await fastify.close();
  });
});
