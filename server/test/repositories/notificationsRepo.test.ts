import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as notificationsRepo from '../../repositories/notificationsRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// drizzle-orm/node-postgres uses rowMode: 'array' for select queries; rows are positional
// in the column-declaration order from db/schema/notifications.ts.

describe('listForUser', () => {
  test('passes userId in the query params', async () => {
    exec.enqueue({ rows: [] });
    await notificationsRepo.listForUser('user-1', testDb);
    expect(exec.calls[0].params).toContain('user-1');
  });

  test('maps a returned row to the Notification shape', async () => {
    const createdAt = new Date(1700000000000);
    exec.enqueue({
      rows: [['n1', 'user-1', 'task', 't', 'm', null, false, createdAt]],
    });
    const result = await notificationsRepo.listForUser('user-1', testDb);
    expect(result).toEqual([
      {
        id: 'n1',
        userId: 'user-1',
        type: 'task',
        title: 't',
        message: 'm',
        data: null,
        isRead: false,
        createdAt: 1700000000000,
      },
    ]);
  });

  test('passes JSONB data through unchanged', async () => {
    const data = { actor: 'u9', refType: 'task', refId: 't1' };
    exec.enqueue({
      rows: [['n1', 'user-1', 'task', 't', 'm', data, false, new Date(1700000000000)]],
    });
    const [result] = await notificationsRepo.listForUser('user-1', testDb);
    expect(result.data).toEqual(data);
  });

  test('coerces null message/createdAt to defaults', async () => {
    exec.enqueue({
      rows: [['n1', 'user-1', 'task', 't', null, null, false, null]],
    });
    const [result] = await notificationsRepo.listForUser('user-1', testDb);
    expect(result.message).toBe('');
    expect(result.createdAt).toBe(0);
  });
});

describe('countUnreadForUser', () => {
  test('returns the count value as a number', async () => {
    exec.enqueue({ rows: [['42']] });
    const result = await notificationsRepo.countUnreadForUser('user-1', testDb);
    expect(result).toBe(42);
  });

  test('returns 0 when no unread notifications exist', async () => {
    exec.enqueue({ rows: [['0']] });
    const result = await notificationsRepo.countUnreadForUser('user-1', testDb);
    expect(result).toBe(0);
  });

  test('passes userId in the query params', async () => {
    exec.enqueue({ rows: [['0']] });
    await notificationsRepo.countUnreadForUser('user-1', testDb);
    expect(exec.calls[0].params).toContain('user-1');
  });

  // Regression test for #614: `IS NOT TRUE` does not match the predicate of
  // partial index `idx_notifications_user_unread` (`is_read = false`), so the
  // unread predicate must compile to `= $N` with a `false` parameter.
  test('uses an `= false` predicate that matches the partial index', async () => {
    exec.enqueue({ rows: [['0']] });
    await notificationsRepo.countUnreadForUser('user-1', testDb);
    expect(exec.calls[0].sql.toLowerCase()).not.toContain('is not true');
    expect(exec.calls[0].params).toContain(false);
  });
});

describe.each([
  ['markReadForUser', () => notificationsRepo.markReadForUser('n1', 'user-1', testDb)],
  ['deleteForUser', () => notificationsRepo.deleteForUser('n1', 'user-1', testDb)],
] as const)('%s', (_label, run) => {
  test.each([
    [1, true],
    [0, false],
    [null, false],
  ] as const)('returns %s when rowCount is %s', async (rowCount, expected) => {
    exec.enqueue({ rows: [], rowCount });
    expect(await run()).toBe(expected);
  });

  test('passes id and userId in the query params', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    await run();
    expect(exec.calls[0].params).toContain('n1');
    expect(exec.calls[0].params).toContain('user-1');
  });
});

describe('markAllReadForUser', () => {
  test('passes userId in the query params and resolves to undefined', async () => {
    exec.enqueue({ rows: [] });
    const result = await notificationsRepo.markAllReadForUser('user-1', testDb);
    expect(result).toBeUndefined();
    expect(exec.calls[0].params).toContain('user-1');
  });
});

describe('admin password warning helpers', () => {
  test('upsertAdminPasswordWarning inserts a deterministic unread warning', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });

    const result = await notificationsRepo.upsertAdminPasswordWarning('admin-1', testDb);

    expect(result).toBeUndefined();
    expect(exec.calls[0].sql.toLowerCase()).toContain('on conflict');
    expect(exec.calls[0].params).toContain(
      notificationsRepo.ADMIN_PASSWORD_WARNING_NOTIFICATION_ID,
    );
    expect(exec.calls[0].params).toContain(notificationsRepo.ADMIN_PASSWORD_WARNING_TYPE);
    expect(exec.calls[0].params).toContain('admin-1');
    expect(exec.calls[0].params).toContain(false);
  });

  test('deleteAdminPasswordWarning deletes by deterministic id', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });

    const result = await notificationsRepo.deleteAdminPasswordWarning(testDb);

    expect(result).toBeUndefined();
    expect(exec.calls[0].params).toContain(
      notificationsRepo.ADMIN_PASSWORD_WARNING_NOTIFICATION_ID,
    );
  });
});
