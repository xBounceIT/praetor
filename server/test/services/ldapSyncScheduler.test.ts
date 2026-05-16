import { describe, expect, mock, test } from 'bun:test';
import type { Logger } from 'pino';
import { startLdapSyncScheduler } from '../../services/ldapSyncScheduler.ts';

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

const createLoggerStub = (): Logger => {
  const stub = {
    info: mock(),
    error: mock(),
    warn: mock(),
    debug: mock(),
    trace: mock(),
    fatal: mock(),
    child: () => stub,
  };
  return stub as unknown as Logger;
};

const createServiceStub = (
  overrides: {
    enabled?: boolean;
    loadConfig?: () => Promise<void> | void;
    syncUsers?: () => Promise<void>;
  } = {},
) => {
  const loadConfig = mock(overrides.loadConfig ?? (async () => {}));
  const syncUsers = mock(overrides.syncUsers ?? (async () => {}));
  return {
    loadConfig,
    syncUsers,
    config: { enabled: overrides.enabled ?? true },
  };
};

describe('startLdapSyncScheduler', () => {
  test('stop() prevents future interval fires', async () => {
    const service = createServiceStub();
    const logger = createLoggerStub();

    const scheduler = startLdapSyncScheduler({
      ldapService: service,
      logger,
      intervalMs: 5,
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    const callsBeforeStop = service.syncUsers.mock.calls.length;
    expect(callsBeforeStop).toBeGreaterThan(0);

    scheduler.stop();
    const callsAtStop = service.syncUsers.mock.calls.length;

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(service.syncUsers.mock.calls.length).toBe(callsAtStop);
  });

  test('stop() suppresses errors from in-flight callbacks', async () => {
    let releaseLoadConfig!: () => void;
    const blockingLoadConfig = new Promise<void>((resolve) => {
      releaseLoadConfig = resolve;
    });
    const service = createServiceStub({
      loadConfig: () => blockingLoadConfig,
      syncUsers: async () => {
        throw new Error('pool has ended');
      },
    });
    const logger = createLoggerStub();

    const scheduler = startLdapSyncScheduler({
      ldapService: service,
      logger,
      intervalMs: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    scheduler.stop();
    releaseLoadConfig();
    await flushMicrotasks();
    await flushMicrotasks();

    expect((logger.error as ReturnType<typeof mock>).mock.calls.length).toBe(0);
    expect(service.syncUsers.mock.calls.length).toBe(0);
  });

  test('skips syncUsers when config is disabled', async () => {
    const service = createServiceStub({ enabled: false });
    const logger = createLoggerStub();

    const scheduler = startLdapSyncScheduler({
      ldapService: service,
      logger,
      intervalMs: 5,
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    scheduler.stop();

    expect(service.loadConfig.mock.calls.length).toBeGreaterThan(0);
    expect(service.syncUsers.mock.calls.length).toBe(0);
  });

  test('inFlight guard prevents overlapping syncUsers calls', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const service = createServiceStub({
      syncUsers: async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 15));
        concurrent--;
      },
    });
    const logger = createLoggerStub();

    const scheduler = startLdapSyncScheduler({
      ldapService: service,
      logger,
      intervalMs: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    scheduler.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(service.syncUsers.mock.calls.length).toBeGreaterThan(0);
    expect(maxConcurrent).toBe(1);
  });

  test('logs and continues when sync throws while running', async () => {
    const service = createServiceStub({
      syncUsers: async () => {
        throw new Error('boom');
      },
    });
    const logger = createLoggerStub();

    const scheduler = startLdapSyncScheduler({
      ldapService: service,
      logger,
      intervalMs: 5,
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    scheduler.stop();

    const errorCalls = (logger.error as ReturnType<typeof mock>).mock.calls;
    expect(errorCalls.length).toBeGreaterThan(0);
    expect(errorCalls[0][0]).toMatchObject({ err: { name: 'Error', message: 'boom' } });
  });
});
