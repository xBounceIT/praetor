import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableName, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { type DbExecutor, db, executeRows, schema } from './drizzle.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = join(__dirname, 'migrations');

type MigrationCountRow = {
  appliedCount: string | number | bigint;
};

export type DbReadinessProbe = {
  name: string;
  run: (exec: DbExecutor) => Promise<unknown>;
};

export type DbReadinessResult = {
  appliedMigrations: number;
  expectedMigrations: number;
  probedTables: string[];
};

type VerifyDbReadinessOptions = {
  exec?: DbExecutor;
  migrationsDir?: string;
  probes?: readonly DbReadinessProbe[];
};

const schemaReadinessTables = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => value instanceof PgTable)
  .map((table) => [getTableName(table), table] as const)
  .sort(([left], [right]) => left.localeCompare(right));

export const schemaReadinessProbes = schemaReadinessTables.map(
  ([name, table]): DbReadinessProbe => ({
    name,
    run: (exec) => exec.select().from(table).limit(0),
  }),
);

const countMigrationFiles = (dir: string): number =>
  readdirSync(dir).filter((fileName) => /^\d+_.+\.sql$/.test(fileName)).length;

const parseMigrationCount = (value: string | number | bigint | undefined): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`Unexpected Drizzle migration count value: ${String(value)}`);
};

export const verifyDbReadiness = async (
  options: VerifyDbReadinessOptions = {},
): Promise<DbReadinessResult> => {
  const exec = options.exec ?? db;
  const expectedMigrations = countMigrationFiles(options.migrationsDir ?? migrationsFolder);
  const probes = options.probes ?? schemaReadinessProbes;

  await executeRows(exec, sql`SELECT 1 AS ok`);

  const migrationRows = await executeRows<MigrationCountRow>(
    exec,
    sql`SELECT COUNT(*) AS "appliedCount" FROM drizzle.__drizzle_migrations`,
  );
  const appliedMigrations = parseMigrationCount(migrationRows[0]?.appliedCount);

  if (appliedMigrations < expectedMigrations) {
    throw new Error(
      `Database migrations incomplete. Applied ${appliedMigrations} of ${expectedMigrations} migration files.`,
    );
  }

  const probedTables = await Promise.all(
    probes.map(async (probe) => {
      try {
        await probe.run(exec);
        return probe.name;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Database schema probe failed for ${probe.name}: ${message}`, {
          cause: err,
        });
      }
    }),
  );

  return { appliedMigrations, expectedMigrations, probedTables };
};
