import dotenv from 'dotenv';
import pg from 'pg';
import { createChildLogger, serializeError } from '../utils/logger.ts';
import { createDbPoolConfig } from './config.ts';

dotenv.config({ quiet: true });

const { Pool } = pg;
const logger = createChildLogger({ module: 'db' });

// The pg pool that backs `db/drizzle.ts`'s `db` instance. Exported so that:
//   - `index.ts` (server bootstrap) can run the schema-bootstrap, table-existence probe,
//     and DB-readiness `SELECT 1` via the `query` helper below before the app starts;
//   - `db/demoSeed.ts` can hold one dedicated client for its complete raw-SQL transaction;
//   - bootstrap helpers and the legacy `db/add_*.ts` artifacts can issue raw parameterized
//     queries via `query` below;
//   - `routes/reports.ts` can build a separate `drizzle(pool, ...)` instance with a query-
//     count `logger`, so per-request dataset budgets stay enforced.
// Application repository code goes through the shared `db` from `db/drizzle.ts`.
const pool = new Pool(createDbPoolConfig());

pool.on('error', (err) => {
  logger.error({ err: serializeError(err) }, 'Unexpected error on idle database client');
});

// Used by server bootstrap helpers and frozen legacy database scripts. The demo seed also
// intentionally uses raw SQL, but acquires a dedicated client from the pool so cleanup, inserts,
// assignment synchronization, verification, and commit remain in one transaction.
export const query = (text: string, params?: unknown[]) => pool.query(text, params);

// Helper for the demo seed's bulk inserts.
export const buildBulkInsertPlaceholders = (
  rowCount: number,
  fieldsPerRow: number,
  startIndex = 1,
): string => {
  const rows = new Array<string>(rowCount);
  for (let i = 0; i < rowCount; i++) {
    const base = startIndex + i * fieldsPerRow;
    const slots = new Array<string>(fieldsPerRow);
    for (let n = 0; n < fieldsPerRow; n++) slots[n] = `$${base + n}`;
    rows[i] = `(${slots.join(', ')})`;
  }
  return rows.join(', ');
};

export default pool;
