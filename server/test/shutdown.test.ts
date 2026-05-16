import { describe, expect, test } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { performShutdown } from '../shutdown.ts';

interface LogCall {
  level: 'info' | 'error';
  obj: Record<string, unknown>;
  msg: string;
}

const makeLogger = () => {
  const calls: LogCall[] = [];
  const record = (level: LogCall['level']) => (obj: object, msg: string) =>
    calls.push({ level, obj: { ...obj }, msg });
  const stub = { info: record('info'), error: record('error') };
  return { calls, logger: stub as unknown as Logger };
};

const makeFastify = (close: () => Promise<void>): FastifyInstance =>
  ({ close }) as unknown as FastifyInstance;

describe('performShutdown', () => {
  test('returns 0 when fastify.close() resolves', async () => {
    let closeCalls = 0;
    const fastify = makeFastify(async () => {
      closeCalls += 1;
    });
    const { calls, logger } = makeLogger();

    const code = await performShutdown(fastify, 'SIGINT', logger);

    expect(code).toBe(0);
    expect(closeCalls).toBe(1);
    expect(calls).toEqual([{ level: 'info', obj: { signal: 'SIGINT' }, msg: 'Shutting down' }]);
  });

  test('returns 1 when fastify.close() throws', async () => {
    const closeErr = new Error('connection pool drain failed');
    const fastify = makeFastify(async () => {
      throw closeErr;
    });
    const { calls, logger } = makeLogger();

    const code = await performShutdown(fastify, 'SIGTERM', logger);

    expect(code).toBe(1);
    const errorEntry = calls.find((entry) => entry.level === 'error');
    expect(errorEntry).toBeDefined();
    expect(errorEntry?.msg).toBe('Shutdown error');
    expect(errorEntry?.obj.signal).toBe('SIGTERM');
    expect(errorEntry?.obj.err).toBeDefined();
  });
});
