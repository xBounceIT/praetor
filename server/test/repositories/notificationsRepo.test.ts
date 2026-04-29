import { beforeEach, describe, expect, test } from 'bun:test';
import * as notificationsRepo from '../../repositories/notificationsRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

describe('listForUser', () => {
  test('passes userId as $1', async () => {
    exec.enqueue({ rows: [] });
    await notificationsRepo.listForUser('user-1', exec);
    expect(exec.calls[0].params).toEqual(['user-1']);
  });

  test('returns rows verbatim from the query', async () => {
    const row = {
      id: 'n1',
      userId: 'user-1',
      type: 'task',
      title: 't',
      message: 'm',
      data: null,
      isRead: false,
      createdAt: 1700000000000,
    };
    exec.enqueue({ rows: [row] });
    const result = await notificationsRepo.listForUser('user-1', exec);
    expect(result).toEqual([row]);
  });
});

describe('countUnreadForUser', () => {
  test('parses the string count from pg into a JS number', async () => {
    exec.enqueue({ rows: [{ count: '42' }] });
    const result = await notificationsRepo.countUnreadForUser('user-1', exec);
    expect(result).toBe(42);
  });

  test('returns 0 when no unread notifications exist', async () => {
    exec.enqueue({ rows: [{ count: '0' }] });
    const result = await notificationsRepo.countUnreadForUser('user-1', exec);
    expect(result).toBe(0);
  });

  test('passes userId as $1', async () => {
    exec.enqueue({ rows: [{ count: '0' }] });
    await notificationsRepo.countUnreadForUser('user-1', exec);
    expect(exec.calls[0].params).toEqual(['user-1']);
  });
});

describe.each([
  ['markReadForUser', () => notificationsRepo.markReadForUser('n1', 'user-1', exec)],
  ['deleteForUser', () => notificationsRepo.deleteForUser('n1', 'user-1', exec)],
] as const)('%s', (_label, run) => {
  test.each([
    [1, true],
    [0, false],
    [null, false],
  ] as const)('returns %s when rowCount is %s', async (rowCount, expected) => {
    exec.enqueue({ rows: [], rowCount });
    expect(await run()).toBe(expected);
  });

  test('passes [id, userId] as $1, $2', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    await run();
    expect(exec.calls[0].params).toEqual(['n1', 'user-1']);
  });
});

describe('markAllReadForUser', () => {
  test('passes userId as $1 and resolves to undefined', async () => {
    exec.enqueue({ rows: [] });
    const result = await notificationsRepo.markAllReadForUser('user-1', exec);
    expect(result).toBeUndefined();
    expect(exec.calls[0].params).toEqual(['user-1']);
  });
});
