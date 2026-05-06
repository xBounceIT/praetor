import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg, { type PoolClient } from 'pg';
import { createChildLogger, serializeError } from '../utils/logger.ts';
import { createDbPoolConfig, getDbConnectionLabel } from './config.ts';

const logger = createChildLogger({ module: 'db-migrations' });
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = join(__dirname, 'migrations');
const MIGRATION_LOCK_KEY = 'praetor:drizzle-migrations';
const MIGRATION_LOCK_SQL = 'SELECT pg_try_advisory_lock(hashtextextended($1, 0::bigint)) AS locked';
const MIGRATION_UNLOCK_SQL = 'SELECT pg_advisory_unlock(hashtextextended($1, 0::bigint))';
const MIGRATION_LOCK_RETRY_MS = 1_000;
const MIGRATION_LOCK_MAX_ATTEMPTS = 60;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const acquireMigrationLock = async (client: PoolClient): Promise<void> => {
  for (let attempt = 1; attempt <= MIGRATION_LOCK_MAX_ATTEMPTS; attempt += 1) {
    const result = await client.query<{ locked: boolean }>(MIGRATION_LOCK_SQL, [
      MIGRATION_LOCK_KEY,
    ]);

    if (result.rows[0]?.locked === true) {
      return;
    }

    if (attempt === MIGRATION_LOCK_MAX_ATTEMPTS) {
      throw new Error(
        `Timed out waiting for Drizzle migration advisory lock after ${MIGRATION_LOCK_MAX_ATTEMPTS} attempts`,
      );
    }

    logger.warn(
      {
        attempt,
        maxAttempts: MIGRATION_LOCK_MAX_ATTEMPTS,
        retryMs: MIGRATION_LOCK_RETRY_MS,
      },
      'Drizzle migration advisory lock is held; retrying',
    );

    await sleep(MIGRATION_LOCK_RETRY_MS);
  }
};

export const runDrizzleMigrations = async (): Promise<void> => {
  const pool = new pg.Pool(createDbPoolConfig({ max: 1 }));
  let client: PoolClient | undefined;
  let hasMigrationLock = false;

  pool.on('error', (err) => {
    logger.error(
      { err: serializeError(err) },
      'Unexpected error on idle migration database client',
    );
  });

  try {
    client = await pool.connect();

    logger.info(
      {
        database: getDbConnectionLabel(),
        migrationsFolder,
      },
      'Applying Drizzle migrations',
    );

    await acquireMigrationLock(client);
    hasMigrationLock = true;

    const db = drizzle(client);
    await migrate(db, { migrationsFolder });

    logger.info('Drizzle migrations applied or already up to date');
  } finally {
    if (client) {
      if (hasMigrationLock) {
        try {
          await client.query(MIGRATION_UNLOCK_SQL, [MIGRATION_LOCK_KEY]);
        } catch (err) {
          logger.warn(
            { err: serializeError(err) },
            'Failed to release Drizzle migration advisory lock; closing the connection will release it',
          );
        }
      }

      client.release();
    }

    try {
      await pool.end();
    } catch (err) {
      logger.warn({ err: serializeError(err) }, 'Failed to close migration database pool');
    }
  }
};
