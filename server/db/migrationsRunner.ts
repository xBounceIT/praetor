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
const MIGRATION_LOCK_SQL = 'SELECT pg_advisory_lock(hashtextextended($1, 0::bigint))';
const MIGRATION_UNLOCK_SQL = 'SELECT pg_advisory_unlock(hashtextextended($1, 0::bigint))';

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

    await client.query(MIGRATION_LOCK_SQL, [MIGRATION_LOCK_KEY]);
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
