import { afterEach, describe, expect, test } from 'bun:test';
import Fastify from 'fastify';
import { buildErrorResponseMessage, registerErrorHandler } from '../app.ts';

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

const originalNodeEnv = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
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

  test('non-production + 500: original message passes through (developer ergonomics)', () => {
    const result = buildErrorResponseMessage(new Error('SQL near "FROM" failed'), {
      NODE_ENV: 'development',
    } as NodeJS.ProcessEnv);
    expect(result).toEqual({ statusCode: 500, message: 'SQL near "FROM" failed' });
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

  test('non-production: 5xx error messages still pass through to the client', async () => {
    process.env.NODE_ENV = 'development';
    const { fastify } = buildTestApp();

    const response = await fastify.inject({ method: 'GET', url: '/boom-500' });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({ error: 'Database password is hunter2' });

    await fastify.close();
  });
});
