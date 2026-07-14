// Verifies the legacy warning cleanup and replacement upsert share one transaction when
// the repo uses its default executor. If the INSERT fails, the legacy warning must survive.

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as realDrizzle from '../../db/drizzle.ts';

const LEGACY_WARNING_ID = 'admin-default-password-warning';

let table = new Set<string>();
let pending: Set<string> | null = null;
let failNextInsert = false;
let transactionCount = 0;

const live = (): Set<string> => pending ?? table;

const fakeDb = {
  delete() {
    return {
      where: async () => {
        live().delete(LEGACY_WARNING_ID);
        return { rowCount: 1 };
      },
    };
  },
  insert() {
    return {
      values: (row: { id: string }) => ({
        onConflictDoUpdate: async () => {
          if (failNextInsert) {
            failNextInsert = false;
            throw new Error('forced admin warning INSERT failure');
          }
          live().add(row.id);
          return { rowCount: 1 };
        },
      }),
    };
  },
};

const fakeWithDbTransaction = async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
  transactionCount += 1;
  pending = new Set(table);
  try {
    const result = await cb(fakeDb);
    table = pending;
    return result;
  } finally {
    pending = null;
  }
};

const fakeRunAtomically = <T>(exec: unknown, cb: (tx: unknown) => Promise<T>): Promise<T> =>
  exec === fakeDb ? fakeWithDbTransaction(cb) : cb(exec);

const drizzleSnap = { ...realDrizzle };

mock.module('../../db/drizzle.ts', () => ({
  ...drizzleSnap,
  db: fakeDb,
  withDbTransaction: fakeWithDbTransaction,
  runAtomically: fakeRunAtomically,
}));

let notificationsRepo: typeof import('../../repositories/notificationsRepo.ts');

beforeAll(async () => {
  notificationsRepo = await import('../../repositories/notificationsRepo.ts');
});

afterAll(() => {
  mock.module('../../db/drizzle.ts', () => drizzleSnap);
});

beforeEach(() => {
  table = new Set([LEGACY_WARNING_ID]);
  pending = null;
  failNextInsert = false;
  transactionCount = 0;
});

describe('upsertAdminPasswordWarning atomicity', () => {
  test('failed upsert rolls back the legacy warning delete', async () => {
    failNextInsert = true;

    await expect(notificationsRepo.upsertAdminPasswordWarning('admin-1')).rejects.toThrow(
      'forced admin warning INSERT failure',
    );

    expect(transactionCount).toBe(1);
    expect([...table]).toEqual([LEGACY_WARNING_ID]);
  });

  test('successful upsert commits the replacement warning', async () => {
    await notificationsRepo.upsertAdminPasswordWarning('admin-1');

    expect(transactionCount).toBe(1);
    expect([...table]).toEqual([notificationsRepo.adminPasswordWarningNotificationId('admin-1')]);
  });
});
