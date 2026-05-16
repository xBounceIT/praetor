// Asserts `replaceUserRoles` runs its DELETE/INSERT pair inside a single transaction when
// called without a caller-supplied executor: a failing INSERT must roll back the prior
// DELETE so the user does not silently lose every secondary role assignment.

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import * as realDrizzle from '../../db/drizzle.ts';

type Row = { userId: string; roleId: string };

let table: Row[] = [];
let pending: Row[] | null = null;
let forcedFailure: 'INSERT' | 'DELETE' | null = null;

const dialect = new PgDialect();

const live = (): Row[] => pending ?? table;

const detectOp = (sqlText: string): 'INSERT' | 'DELETE' => {
  const head = sqlText.trimStart().toUpperCase();
  if (head.startsWith('INSERT')) return 'INSERT';
  if (head.startsWith('DELETE')) return 'DELETE';
  throw new Error(`replaceUserRoles test: unrecognized SQL: ${sqlText}`);
};

const fakeDb = {
  async execute(sqlObj: unknown) {
    const { sql: text, params } = dialect.sqlToQuery(sqlObj as SQL);
    const op = detectOp(text);

    if (forcedFailure === op) {
      // Self-clear so a single forced failure doesn't keep firing inside the same tx.
      forcedFailure = null;
      throw new Error(`forced ${op} failure on user_roles`);
    }

    if (op === 'DELETE') {
      live().length = 0;
    } else {
      // Repo emits VALUES ($1,$2),($3,$4),... in (userId, roleId) order — read pairs.
      for (let i = 0; i < params.length; i += 2) {
        live().push({ userId: String(params[i]), roleId: String(params[i + 1]) });
      }
    }
    return { rows: [] };
  },
};

// Re-entry as no-op so a `runAtomically(tx, ...)` passthrough doesn't double-snapshot.
const fakeWithDbTransaction = async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
  if (pending) return cb(fakeDb);
  pending = table.slice();
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

// Snapshot the real exports BEFORE mocking so afterAll fully restores them — otherwise
// the mock leaks into later tests in the same Bun process.
const drizzleSnap = { ...realDrizzle };

mock.module('../../db/drizzle.ts', () => ({
  ...drizzleSnap,
  db: fakeDb,
  withDbTransaction: fakeWithDbTransaction,
  runAtomically: fakeRunAtomically,
}));

let usersRepo: typeof import('../../repositories/usersRepo.ts');

beforeAll(async () => {
  usersRepo = await import('../../repositories/usersRepo.ts');
});

afterAll(() => {
  mock.module('../../db/drizzle.ts', () => drizzleSnap);
});

beforeEach(() => {
  table = [];
  pending = null;
  forcedFailure = null;
});

describe('replaceUserRoles atomicity', () => {
  test('failed INSERT leaves prior roles intact (DELETE rolled back)', async () => {
    table = [
      { userId: 'u-1', roleId: 'manager' },
      { userId: 'u-1', roleId: 'user' },
    ];
    forcedFailure = 'INSERT';

    await expect(usersRepo.replaceUserRoles('u-1', ['ghost-role'])).rejects.toThrow(
      'forced INSERT failure on user_roles',
    );

    expect(table.map((r) => r.roleId)).toEqual(['manager', 'user']);
  });

  test('successful replace commits new roles and drops old ones', async () => {
    table = [{ userId: 'u-1', roleId: 'old-role' }];

    await usersRepo.replaceUserRoles('u-1', ['manager', 'user']);

    expect(table).toEqual([
      { userId: 'u-1', roleId: 'manager' },
      { userId: 'u-1', roleId: 'user' },
    ]);
  });

  test('empty role list commits the DELETE (no INSERT)', async () => {
    table = [{ userId: 'u-1', roleId: 'old-role' }];

    await usersRepo.replaceUserRoles('u-1', []);

    expect(table).toEqual([]);
  });
});
