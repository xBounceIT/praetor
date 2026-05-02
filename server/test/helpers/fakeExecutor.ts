import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool, QueryResult, QueryResultRow } from 'pg';
import type { DbExecutor } from '../../db/drizzle.ts';
import type { QueryExecutor } from '../../db/index.ts';
import * as schema from '../../db/schema/index.ts';

export type FakeCall = { sql: string; params: unknown[] };

export type FakeResponse = {
  rows: QueryResultRow[];
  rowCount?: number | null;
};

type ResponseFactory = (sql: string, params: unknown[]) => FakeResponse;

export type FakeExecutor = QueryExecutor & {
  readonly calls: readonly FakeCall[];
  enqueue: (response: FakeResponse | ResponseFactory) => void;
};

export const makeFakeExecutor = (): FakeExecutor => {
  const calls: FakeCall[] = [];
  const queue: Array<FakeResponse | ResponseFactory> = [];

  const exec: FakeExecutor = {
    calls,
    enqueue(response) {
      queue.push(response);
    },
    async query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      params: unknown[] = [],
    ): Promise<QueryResult<T>> {
      calls.push({ sql: text, params });
      const next = queue.shift();
      const resp: FakeResponse =
        typeof next === 'function' ? next(text, params) : (next ?? { rows: [] });
      const rows = resp.rows as T[];
      const rowCount: number | null = resp.rowCount === undefined ? rows.length : resp.rowCount;
      return {
        rows,
        rowCount,
        command: '',
        oid: 0,
        fields: [],
      };
    },
  };

  return exec;
};

// Drizzle's node-postgres driver invokes `client.query(config, params)` where `config` is
// a `{ text, rowMode, ... }` object — not a string. This adapter translates both call shapes
// so the fake records the SQL string (rather than the raw config object) and so SQL-string
// assertions in tests stay readable.
//
// Note: only `.query()` is implemented. Drizzle's `db.transaction(...)` calls `.connect()` on
// the pool, which would fail here — this pattern is for unit-testing non-transactional repo
// code paths. Repo functions wrapped in `withDbTransaction` by route code are fine to test
// individually here because the unit test passes `testDb` directly (no transaction involved).
export const makePoolAdapter = (fake: FakeExecutor): Pool =>
  ({
    query(textOrConfig: string | { text: string; values?: unknown[] }, params?: unknown[]) {
      const text = typeof textOrConfig === 'string' ? textOrConfig : textOrConfig.text;
      const values = params ?? (typeof textOrConfig === 'string' ? undefined : textOrConfig.values);
      return fake.query(text, values);
    },
  }) as unknown as Pool;

// Drizzle's node-postgres driver returns SELECT rows in `rowMode: 'array'` — positional
// arrays in the column-declaration order from the schema file. Tests use this to build
// fixture rows without naming each column. Pass a base array matching the schema column
// order, then override individual positions by index.
export const makeRow = (
  base: readonly unknown[],
  overrides: Record<number, unknown> = {},
): unknown[] => {
  const row = base.slice();
  for (const [k, v] of Object.entries(overrides)) row[Number(k)] = v;
  return row;
};

// Standard test DB setup: a fresh fake executor wired to a Drizzle instance via the pool
// adapter. Use in `beforeEach` blocks to reset state per test.
export const setupTestDb = (): { exec: FakeExecutor; testDb: DbExecutor } => {
  const exec = makeFakeExecutor();
  const testDb = drizzle(makePoolAdapter(exec), { schema });
  return { exec, testDb };
};
