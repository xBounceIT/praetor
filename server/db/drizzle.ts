import type { ExtractTablesWithRelations, SQL } from 'drizzle-orm';
import { drizzle, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import pool from './index.ts';
import * as schema from './schema/index.ts';

export const db = drizzle(pool, { schema });

export type DbExecutor = PgDatabase<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

// Wraps a Drizzle transaction so the callback receives a `tx` typed as `DbExecutor`. Routes
// call this when they need to compose multiple repo calls atomically:
//
//   await withDbTransaction(async (tx) => {
//     await fooRepo.create(input, tx);
//     await barRepo.update(input, tx);
//   });
//
// The `tx as unknown as DbExecutor` cast bridges Drizzle's `PgTransaction` and `PgDatabase`
// types — both implement the same query-builder surface (`select`, `insert`, `update`,
// `delete`, `execute`, `transaction` for nesting) that `DbExecutor` exposes, but the two
// classes don't share a nominal supertype that includes both, so TS rejects the direct cast.
// The `unknown` step is a structural-equivalence assertion, not a load-bearing contract.
export const withDbTransaction = <T>(callback: (tx: DbExecutor) => Promise<T>): Promise<T> =>
  db.transaction((tx) => callback(tx as unknown as DbExecutor));

// `exec.execute(sql)` returns either `{ rows }` (real pg driver) or a bare array (some test
// adapters). Normalize so callers always get `T[]`. Throws on an unrecognized shape so a
// driver/adapter mismatch surfaces loudly instead of silently returning empty rows.
export const executeRows = async <T>(exec: DbExecutor, query: SQL): Promise<T[]> => {
  const result = await exec.execute(query);
  const rows = (result as { rows?: T[] }).rows;
  if (Array.isArray(rows)) return rows;
  if (Array.isArray(result)) return result as T[];
  // Include diagnostic context so a driver upgrade or test-fake misconfig is debuggable
  // from the stack trace alone.
  const resultType = result === null ? 'null' : typeof result;
  const hasRowsKey = result !== null && typeof result === 'object' && 'rows' in result;
  throw new Error(
    `executeRows: unexpected result shape from exec.execute (resultType=${resultType}, hasRowsKey=${hasRowsKey}, rowsType=${typeof rows})`,
  );
};
