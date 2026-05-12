import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { createChildLogger } from '../utils/logger.ts';
import { runDrizzleMigrationsWithClient, withMigrationLock } from './migrationsRunner.ts';
import { type DbReadinessResult, verifyDbReadiness } from './readiness.ts';

const logger = createChildLogger({ module: 'db-startup' });
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const defaultSchemaPath = join(__dirname, 'schema.sql');
const DRIZZLE_MIGRATION_LEDGER = 'drizzle.__drizzle_migrations';

type QueryableClient = {
  query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ) => Promise<QueryResult<T>>;
};

type StartupLogger = {
  info: (message: string) => void;
};

export type PrepareDatabaseForStartupOptions = {
  schemaPath?: string;
  logger?: StartupLogger;
  withLock?: <T>(callback: (client: PoolClient) => Promise<T>) => Promise<T>;
  runMigrations?: (client: PoolClient) => Promise<void>;
  verifyReadiness?: () => Promise<DbReadinessResult>;
  readSchemaSql?: (path: string) => string;
};

type LedgerExistsRow = {
  exists: boolean;
};

export const hasDrizzleMigrationLedger = async (client: QueryableClient): Promise<boolean> => {
  const result = await client.query<LedgerExistsRow>(
    'SELECT to_regclass($1) IS NOT NULL AS "exists"',
    [DRIZZLE_MIGRATION_LEDGER],
  );

  return result.rows[0]?.exists === true;
};

const readHistoricalSchemaSql = (schemaPath: string): string => {
  if (!existsSync(schemaPath)) {
    throw new Error(`Schema file not found at ${schemaPath}`);
  }

  return readFileSync(schemaPath, 'utf8');
};

export const prepareDatabaseForStartup = async (
  options: PrepareDatabaseForStartupOptions = {},
): Promise<DbReadinessResult> => {
  const schemaPath = options.schemaPath ?? defaultSchemaPath;
  const startupLogger = options.logger ?? logger;
  const runWithLock = options.withLock ?? withMigrationLock;
  const runMigrations = options.runMigrations ?? runDrizzleMigrationsWithClient;
  const checkReadiness = options.verifyReadiness ?? verifyDbReadiness;
  const readSchemaSql = options.readSchemaSql ?? readHistoricalSchemaSql;

  return runWithLock(async (client) => {
    const ledgerExists = await hasDrizzleMigrationLedger(client);

    if (ledgerExists) {
      startupLogger.info('Historical schema bootstrap skipped; Drizzle migration ledger exists');
    } else {
      const schemaSql = readSchemaSql(schemaPath);
      await client.query(schemaSql);
      startupLogger.info('Historical schema bootstrap applied');
    }

    await runMigrations(client);
    startupLogger.info('Drizzle migrations applied or already up to date');

    return checkReadiness();
  });
};
