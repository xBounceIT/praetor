import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type MigrationMeta, readMigrationFiles } from 'drizzle-orm/migrator';
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
const DRIZZLE_MIGRATIONS_SCHEMA = 'drizzle';
const DRIZZLE_MIGRATIONS_TABLE = '__drizzle_migrations';
const CREATE_MIGRATIONS_SCHEMA_SQL = `CREATE SCHEMA IF NOT EXISTS "${DRIZZLE_MIGRATIONS_SCHEMA}"`;
const CREATE_MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS "${DRIZZLE_MIGRATIONS_SCHEMA}"."${DRIZZLE_MIGRATIONS_TABLE}" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )
`;
const SELECT_APPLIED_MIGRATION_HASHES_SQL = `
  SELECT hash
  FROM "${DRIZZLE_MIGRATIONS_SCHEMA}"."${DRIZZLE_MIGRATIONS_TABLE}"
  ORDER BY id ASC
`;
const INSERT_APPLIED_MIGRATION_SQL = `
  INSERT INTO "${DRIZZLE_MIGRATIONS_SCHEMA}"."${DRIZZLE_MIGRATIONS_TABLE}" ("hash", "created_at")
  VALUES ($1, $2)
`;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type AppliedMigrationHashRow = {
  hash: string;
};

type RunDrizzleMigrationsOptions = {
  migrationsDir?: string;
};

const countHashes = (hashes: Iterable<string>): Map<string, number> => {
  const counts = new Map<string, number>();

  for (const hash of hashes) {
    counts.set(hash, (counts.get(hash) ?? 0) + 1);
  }

  return counts;
};

const validateAppliedMigrationHashes = (
  migrations: readonly MigrationMeta[],
  appliedHashCounts: ReadonlyMap<string, number>,
) => {
  const expectedHashCounts = countHashes(migrations.map((migration) => migration.hash));

  for (const [hash, appliedCount] of appliedHashCounts) {
    const expectedCount = expectedHashCounts.get(hash) ?? 0;
    if (appliedCount <= expectedCount) continue;

    throw new Error(
      [
        'Drizzle migration ledger contains applied migration hashes that do not match the current migration files.',
        `Hash ${hash.slice(0, 12)} is present ${appliedCount} time(s) in the database ledger but ${expectedCount} time(s) in the migration journal.`,
        'This usually means an already-applied migration file was edited; refusing to infer pending migrations automatically.',
      ].join(' '),
    );
  }
};

const getPendingMigrations = (
  migrations: readonly MigrationMeta[],
  appliedHashCounts: ReadonlyMap<string, number>,
): MigrationMeta[] => {
  const remainingAppliedHashCounts = new Map(appliedHashCounts);
  const pendingMigrations: MigrationMeta[] = [];

  for (const migration of migrations) {
    const remainingAppliedCount = remainingAppliedHashCounts.get(migration.hash) ?? 0;

    if (remainingAppliedCount > 0) {
      remainingAppliedHashCounts.set(migration.hash, remainingAppliedCount - 1);
      continue;
    }

    pendingMigrations.push(migration);
  }

  return pendingMigrations;
};

const hasOutOfOrderMigrationTimestamps = (migrations: readonly MigrationMeta[]): boolean =>
  migrations.some((migration, index) => {
    const previousMigration = migrations[index - 1];
    return (
      previousMigration !== undefined && migration.folderMillis <= previousMigration.folderMillis
    );
  });

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

export const runDrizzleMigrationsWithClient = async (
  client: PoolClient,
  options: RunDrizzleMigrationsOptions = {},
): Promise<void> => {
  const migrationsDir = options.migrationsDir ?? migrationsFolder;
  const migrations = readMigrationFiles({ migrationsFolder: migrationsDir });

  await client.query(CREATE_MIGRATIONS_SCHEMA_SQL);
  await client.query(CREATE_MIGRATIONS_TABLE_SQL);

  const appliedMigrationRows = await client.query<AppliedMigrationHashRow>(
    SELECT_APPLIED_MIGRATION_HASHES_SQL,
  );
  const appliedHashCounts = countHashes(appliedMigrationRows.rows.map((row) => row.hash));

  validateAppliedMigrationHashes(migrations, appliedHashCounts);

  const pendingMigrations = getPendingMigrations(migrations, appliedHashCounts);
  if (pendingMigrations.length === 0) {
    return;
  }

  if (hasOutOfOrderMigrationTimestamps(migrations)) {
    logger.warn(
      {
        migrationsDir,
        pendingMigrationCount: pendingMigrations.length,
      },
      'Drizzle migration journal timestamps are not monotonic; applying pending migrations by hash',
    );
  }

  await client.query('BEGIN');
  try {
    for (const migration of pendingMigrations) {
      for (const statement of migration.sql) {
        if (statement.trim().length === 0) continue;
        await client.query(statement);
      }

      await client.query(INSERT_APPLIED_MIGRATION_SQL, [
        migration.hash,
        String(migration.folderMillis),
      ]);
    }

    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.warn(
        { err: serializeError(rollbackErr) },
        'Failed to roll back Drizzle migration transaction',
      );
    }

    throw err;
  }
};

export const withMigrationLock = async <T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> => {
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

    return await callback(client);
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

export const runDrizzleMigrations = async (): Promise<void> => {
  await withMigrationLock(async (client) => {
    await runDrizzleMigrationsWithClient(client);
    logger.info('Drizzle migrations applied or already up to date');
  });
};
