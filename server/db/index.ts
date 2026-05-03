import dotenv from 'dotenv';
import pg from 'pg';
import { createChildLogger, serializeError } from '../utils/logger.ts';

dotenv.config();

const { Pool } = pg;
const logger = createChildLogger({ module: 'db' });

const envInt = (key: string, fallback: number) => {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
};

// The pg pool that backs `db/drizzle.ts`'s `db` instance. Exported so that:
//   - the demo-seed scripts (`db/demoSeed.ts`, `scripts/seed-demo.ts`) and the legacy
//     `db/add_*.ts` artifacts can issue raw parameterized queries via `query` below;
//   - `routes/reports.ts` can build a separate `drizzle(pool, …)` instance with a query-
//     count `logger`, so per-request dataset budgets stay enforced.
// Application repository code goes through the shared `db` from `db/drizzle.ts`.
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tempo',
  user: process.env.DB_USER || 'tempo',
  password: process.env.DB_PASSWORD || 'tempo',
  max: envInt('PG_POOL_MAX', 10),
  idleTimeoutMillis: envInt('PG_POOL_IDLE_TIMEOUT_MS', 300_000),
  connectionTimeoutMillis: envInt('PG_POOL_CONN_TIMEOUT_MS', 2_000),
});

pool.on('error', (err) => {
  logger.error({ err: serializeError(err) }, 'Unexpected error on idle database client');
});

// Used only by the demo-seed bootstrap scripts (`db/demoSeed.ts`, `scripts/seed-demo.ts`),
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
