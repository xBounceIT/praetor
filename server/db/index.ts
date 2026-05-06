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
//   - the demo-seed scripts (`db/demoSeed.ts`, `scripts/seed-demo.ts`) and the legacy
//     `db/add_*.ts` artifacts can issue raw parameterized queries via `query` below;
//   - `routes/reports.ts` can build a separate `drizzle(pool, …)` instance with a query-
//     count `logger`, so per-request dataset budgets stay enforced.
// Application repository code goes through the shared `db` from `db/drizzle.ts`.
const pool = new Pool(createDbPoolConfig());

pool.on('error', (err) => {
  logger.error({ err: serializeError(err) }, 'Unexpected error on idle database client');
});

// Used by the server-bootstrap path in `index.ts` (raw schema apply, table probe, DB
// readiness check) and by the demo-seed scripts (`db/demoSeed.ts`, `scripts/seed-demo.ts`),
// which intentionally bypass Drizzle for predictable raw-SQL inserts.
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
