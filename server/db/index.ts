import dotenv from 'dotenv';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
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

export const query = (text: string, params?: unknown[]) => pool.query(text, params);

export const buildBulkInsertPlaceholders = (rowCount: number, fieldsPerRow: number): string => {
  const rows = new Array<string>(rowCount);
  for (let i = 0; i < rowCount; i++) {
    const base = i * fieldsPerRow;
    const slots = new Array<string>(fieldsPerRow);
    for (let n = 0; n < fieldsPerRow; n++) slots[n] = `$${base + n + 1}`;
    rows[i] = `(${slots.join(', ')})`;
  }
  return rows.join(', ');
};

export type QueryExecutor = {
  query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ) => Promise<QueryResult<T>>;
};

export const withTransaction = async <T>(callback: (client: PoolClient) => Promise<T>) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error(
        {
          err: serializeError(rollbackErr),
          originalErr: serializeError(err),
        },
        'Failed to rollback database transaction',
      );
    }
    throw err;
  } finally {
    client.release();
  }
};

export default pool;
