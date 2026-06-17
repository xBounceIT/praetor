// Asserts that `replaceAssignments` and `syncTopManagerAssignmentsForUser` run their
// DELETE/INSERT pairs inside a single transaction, so a failing later statement rolls
// back any earlier ones. Mocks `db/drizzle.ts` with an in-memory tx-aware fake.

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import * as realDrizzle from '../../db/drizzle.ts';
import {
  type AssignmentSource,
  MANUAL_ASSIGNMENT_SOURCE,
  TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE,
} from '../../db/schema/_userAssignmentTable.ts';
import * as realRolesRepo from '../../repositories/rolesRepo.ts';

type Row = { userId: string; refId: string; source: string };
type TableKey = 'user_clients' | 'user_projects' | 'user_tasks';
const TABLE_KEYS: readonly TableKey[] = ['user_clients', 'user_projects', 'user_tasks'];

const tables: Record<TableKey, Row[]> = {
  user_clients: [],
  user_projects: [],
  user_tasks: [],
};

let pending: Record<TableKey, Row[]> | null = null;
const tableObjToKey = new WeakMap<object, TableKey>();
const dialect = new PgDialect();

let forcedFailure: { op: 'INSERT' | 'DELETE'; table: TableKey } | null = null;

const live = (): Record<TableKey, Row[]> => pending ?? tables;

const cloneTables = (): Record<TableKey, Row[]> => {
  const snap = {} as Record<TableKey, Row[]>;
  for (const k of TABLE_KEYS) snap[k] = tables[k].slice();
  return snap;
};

type StatementTarget = { op: 'INSERT' | 'DELETE'; table: TableKey };

// Match every INSERT/DELETE target in statement order. The sync-top-manager paths use CTEs
// that contain several DML statements in one round trip; replacements use a single DML.
const detectStatementTargets = (sqlText: string): StatementTarget[] => {
  const targets: StatementTarget[] = [];
  const pattern =
    /\b(INSERT\s+INTO|DELETE\s+FROM)\s+"?(user_clients|user_projects|user_tasks)"?\b/gi;
  for (const match of sqlText.matchAll(pattern)) {
    targets.push({
      op: match[1].toUpperCase().startsWith('INSERT') ? 'INSERT' : 'DELETE',
      table: match[2].toLowerCase() as TableKey,
    });
  }
  return targets;
};

const fakeDb = {
  delete(table: object) {
    return {
      where: async (_filter: unknown) => {
        const key = tableObjToKey.get(table);
        if (!key) throw new Error('userAssignments test: unknown delete target');
        // The repo's actual deletes are scoped to (userId, assignment_source). Tests
        // seed only matching rows for the test user, so a full clear is equivalent
        // and avoids decoding Drizzle's filter expressions.
        live()[key].length = 0;
        return { rowCount: 0 };
      },
    };
  },
  async execute(sqlObj: unknown) {
    const { sql: text } = dialect.sqlToQuery(sqlObj as SQL);
    const targets = detectStatementTargets(text);
    if (targets.length === 0) {
      throw new Error(`userAssignments test: unrecognized SQL (no known table): ${text}`);
    }

    for (const { op, table } of targets) {
      if (forcedFailure?.op === op && forcedFailure.table === table) {
        // Self-clear so a single forced failure doesn't keep firing inside the same tx.
        forcedFailure = null;
        throw new Error(`forced ${op} failure on ${table}`);
      }

      if (op === 'DELETE') {
        live()[table].length = 0;
      } else {
        // Sentinel row: the rollback property under test doesn't depend on what got inserted.
        live()[table].push({ userId: 'inserted', refId: 'inserted', source: 'inserted' });
      }
    }
    return { rows: [] };
  },
};

// Re-entry as no-op so a `runAtomically(tx, ...)` passthrough doesn't double-snapshot.
const fakeWithDbTransaction = async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
  if (pending) return cb(fakeDb);
  pending = cloneTables();
  try {
    const result = await cb(fakeDb);
    for (const k of TABLE_KEYS) tables[k] = pending[k];
    return result;
  } finally {
    pending = null;
  }
};

const fakeRunAtomically = <T>(exec: unknown, cb: (tx: unknown) => Promise<T>): Promise<T> =>
  exec === fakeDb ? fakeWithDbTransaction(cb) : cb(exec);

// Snapshot real exports BEFORE mocking so the afterAll restore covers every key —
// otherwise the mock leaks into later tests in the same Bun process.
const drizzleSnap = { ...realDrizzle };
const rolesRepoSnap = { ...realRolesRepo };

mock.module('../../db/drizzle.ts', () => ({
  ...drizzleSnap,
  db: fakeDb,
  withDbTransaction: fakeWithDbTransaction,
  runAtomically: fakeRunAtomically,
}));

let userHasRoleResult = false;
mock.module('../../repositories/rolesRepo.ts', () => ({
  ...rolesRepoSnap,
  userHasRole: async () => userHasRoleResult,
}));

let userAssignmentsRepo: typeof import('../../repositories/userAssignmentsRepo.ts');

beforeAll(async () => {
  const clientsSchema = await import('../../db/schema/clients.ts');
  const projectsSchema = await import('../../db/schema/projects.ts');
  const tasksSchema = await import('../../db/schema/tasks.ts');
  tableObjToKey.set(clientsSchema.userClients as unknown as object, 'user_clients');
  tableObjToKey.set(projectsSchema.userProjects as unknown as object, 'user_projects');
  tableObjToKey.set(tasksSchema.userTasks as unknown as object, 'user_tasks');

  userAssignmentsRepo = await import('../../repositories/userAssignmentsRepo.ts');
});

afterAll(() => {
  mock.module('../../db/drizzle.ts', () => drizzleSnap);
  mock.module('../../repositories/rolesRepo.ts', () => rolesRepoSnap);
});

beforeEach(() => {
  for (const k of TABLE_KEYS) tables[k] = [];
  pending = null;
  forcedFailure = null;
  userHasRoleResult = false;
});

type ReplaceFn = (userId: string, ids: string[], source: AssignmentSource) => Promise<void>;

describe.each<readonly [string, () => ReplaceFn, TableKey]>([
  ['replaceUserClients', () => userAssignmentsRepo.replaceUserClients, 'user_clients'],
  ['replaceUserProjects', () => userAssignmentsRepo.replaceUserProjects, 'user_projects'],
  ['replaceUserTasks', () => userAssignmentsRepo.replaceUserTasks, 'user_tasks'],
])('%s atomicity', (_label, getFn, tableKey) => {
  // `getFn` is a thunk because `userAssignmentsRepo` is loaded in `beforeAll`, after the
  // describe.each tuple is evaluated.
  const callRepo = (ids: string[]) => getFn()('u-1', ids, MANUAL_ASSIGNMENT_SOURCE);

  test('failed INSERT leaves prior assignments intact (DELETE rolled back)', async () => {
    tables[tableKey] = [
      { userId: 'u-1', refId: 'old-1', source: MANUAL_ASSIGNMENT_SOURCE },
      { userId: 'u-1', refId: 'old-2', source: MANUAL_ASSIGNMENT_SOURCE },
    ];
    forcedFailure = { op: 'INSERT', table: tableKey };

    await expect(callRepo(['ghost-id'])).rejects.toThrow(`forced INSERT failure on ${tableKey}`);

    expect(tables[tableKey].map((r) => r.refId)).toEqual(['old-1', 'old-2']);
  });

  test('successful replace commits new ids and drops old ones', async () => {
    tables[tableKey] = [{ userId: 'u-1', refId: 'old-1', source: MANUAL_ASSIGNMENT_SOURCE }];

    await callRepo(['new-1']);

    expect(tables[tableKey]).toHaveLength(1);
    expect(tables[tableKey][0].refId).toBe('inserted');
  });
});

describe('syncTopManagerAssignmentsForUser atomicity', () => {
  const seedTopManagerAutoRows = () => {
    tables.user_clients = [
      { userId: 'u-1', refId: 'c-1', source: TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE },
    ];
    tables.user_projects = [
      { userId: 'u-1', refId: 'p-1', source: TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE },
    ];
    tables.user_tasks = [
      { userId: 'u-1', refId: 't-1', source: TOP_MANAGER_AUTO_ASSIGNMENT_SOURCE },
    ];
  };

  test('non-TM branch: failed cascade INSERT leaves prior top_manager_auto rows intact', async () => {
    userHasRoleResult = false;
    seedTopManagerAutoRows();
    // Cascade rebuild is the only INSERT in this branch and targets user_clients.
    forcedFailure = { op: 'INSERT', table: 'user_clients' };

    await expect(userAssignmentsRepo.syncTopManagerAssignmentsForUser('u-1')).rejects.toThrow(
      'forced INSERT failure on user_clients',
    );

    expect(tables.user_clients.map((r) => r.refId)).toEqual(['c-1']);
    expect(tables.user_projects.map((r) => r.refId)).toEqual(['p-1']);
    expect(tables.user_tasks.map((r) => r.refId)).toEqual(['t-1']);
  });

  test('non-TM branch: successful sync clears top_manager_auto rows', async () => {
    userHasRoleResult = false;
    seedTopManagerAutoRows();

    await userAssignmentsRepo.syncTopManagerAssignmentsForUser('u-1');

    expect(tables.user_clients.map((r) => r.refId)).toEqual(['inserted']);
    expect(tables.user_projects).toEqual([]);
    expect(tables.user_tasks).toEqual([]);
  });

  test('TM branch: failed assign-all INSERT leaves all three tables empty', async () => {
    userHasRoleResult = true;
    forcedFailure = { op: 'INSERT', table: 'user_projects' };

    await expect(userAssignmentsRepo.syncTopManagerAssignmentsForUser('u-1')).rejects.toThrow(
      'forced INSERT failure on user_projects',
    );

    expect(tables.user_clients).toEqual([]);
    expect(tables.user_projects).toEqual([]);
    expect(tables.user_tasks).toEqual([]);
  });

  test('TM branch: successful sync runs all three INSERT...SELECT', async () => {
    userHasRoleResult = true;

    await userAssignmentsRepo.syncTopManagerAssignmentsForUser('u-1');

    expect(tables.user_clients).toHaveLength(1);
    expect(tables.user_projects).toHaveLength(1);
    expect(tables.user_tasks).toHaveLength(1);
  });
});
