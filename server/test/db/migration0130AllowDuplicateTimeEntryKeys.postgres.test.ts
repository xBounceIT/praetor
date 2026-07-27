import { describe, expect, test } from 'bun:test';
import pg, { type PoolClient } from 'pg';
import { createDbPoolConfig } from '../../db/config.ts';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const SHOULD_SKIP = process.env.RUN_TIME_ENTRY_DUPLICATE_KEY_MIGRATION_TEST !== '1';
const MIGRATION = readMigrationFile('0130_allow_duplicate_time_entry_keys.sql');
const STATEMENTS = MIGRATION.split('--> statement-breakpoint').filter(
  (statement) => statement.trim().length > 0,
);
const CONCURRENT_INDEX_STATEMENT_PATTERN =
  /(?:^|\n)\s*(?:CREATE\s+(?:UNIQUE\s+)?INDEX|DROP\s+INDEX)\s+CONCURRENTLY\b/i;

const executeMigrationStatements = async (client: PoolClient) => {
  for (const statement of STATEMENTS) {
    if (!CONCURRENT_INDEX_STATEMENT_PATTERN.test(statement)) {
      throw new Error(`Unexpected non-concurrent statement in migration 0130: ${statement}`);
    }
    await client.query(statement);
  }
};

const indexState = async (client: PoolClient, indexName: string) => {
  const result = await client.query<{ indexdef: string; indisvalid: boolean }>(
    `
    SELECT "indexes"."indexdef", "catalog"."indisvalid"
    FROM "pg_indexes" AS "indexes"
    JOIN "pg_class" AS "class" ON "class"."relname" = "indexes"."indexname"
    JOIN "pg_index" AS "catalog" ON "catalog"."indexrelid" = "class"."oid"
    WHERE "indexes"."schemaname" = 'public'
      AND "indexes"."indexname" = $1
  `,
    [indexName],
  );
  return result.rows[0] ?? null;
};

describe.skipIf(SHOULD_SKIP)(
  'migration 0130: allow duplicate time-entry keys on legacy data',
  () => {
    test('replaces the unique entry-key index and remains retry-safe', async () => {
      const pool = new pg.Pool(createDbPoolConfig({ max: 1 }));
      const client = await pool.connect();

      try {
        await client.query(
          'DROP INDEX CONCURRENTLY IF EXISTS "idx_time_entries_user_date_project_task"',
        );
        await client.query('DROP INDEX CONCURRENTLY IF EXISTS "idx_time_entries_entry_key_unique"');
        await client.query(`
        CREATE UNIQUE INDEX CONCURRENTLY "idx_time_entries_entry_key_unique"
        ON "time_entries" USING btree ("user_id", "date", "project_id", "task")
      `);
        // Partial leftover from an interrupted prior attempt: replacement exists while unique remains.
        await client.query(`
        CREATE INDEX CONCURRENTLY "idx_time_entries_user_date_project_task"
        ON "time_entries" USING btree ("user_id", "date", "project_id", "task")
      `);

        const beforeUnique = await indexState(client, 'idx_time_entries_entry_key_unique');
        expect(beforeUnique?.indexdef).toContain('UNIQUE INDEX idx_time_entries_entry_key_unique');
        expect(await indexState(client, 'idx_time_entries_user_date_project_task')).not.toBeNull();

        await executeMigrationStatements(client);

        expect(await indexState(client, 'idx_time_entries_entry_key_unique')).toBeNull();
        const afterFirst = await indexState(client, 'idx_time_entries_user_date_project_task');
        expect(afterFirst?.indexdef).toContain('INDEX idx_time_entries_user_date_project_task');
        expect(afterFirst?.indexdef).not.toContain('UNIQUE');
        expect(afterFirst?.indisvalid).toBe(true);

        await client.query(`
        INSERT INTO "roles" ("id", "name")
        VALUES ('mig0130_role', 'Migration 0130 Role')
        ON CONFLICT ("id") DO NOTHING
      `);
        await client.query(`
        INSERT INTO "users" (
          "id", "name", "username", "password_hash", "role", "avatar_initials"
        )
        VALUES (
          'mig0130_user', 'Migration User', 'mig0130_user', 'unused',
          'mig0130_role', 'MU'
        )
        ON CONFLICT ("id") DO NOTHING
      `);
        await client.query(`
        INSERT INTO "clients" ("id", "name")
        VALUES ('mig0130_client', 'Migration Client')
        ON CONFLICT ("id") DO NOTHING
      `);
        await client.query(`
        INSERT INTO "projects" ("id", "name", "client_id")
        VALUES ('mig0130_project', 'Migration Project', 'mig0130_client')
        ON CONFLICT ("id") DO NOTHING
      `);
        await client.query(`DELETE FROM "time_entries" WHERE "user_id" = 'mig0130_user'`);
        await client.query(`
        INSERT INTO "time_entries" (
          "id", "user_id", "date", "client_id", "client_name", "project_id",
          "project_name", "task", "duration"
        )
        VALUES
          (
            'mig0130_a', 'mig0130_user', '2026-07-02', 'mig0130_client',
            'Migration Client', 'mig0130_project', 'Migration Project', 'Dev', 2
          ),
          (
            'mig0130_b', 'mig0130_user', '2026-07-02', 'mig0130_client',
            'Migration Client', 'mig0130_project', 'Migration Project', 'Dev', 3
          )
      `);

        // Re-running the migration must remain safe after a partial prior attempt.
        await executeMigrationStatements(client);
        const afterRetry = await indexState(client, 'idx_time_entries_user_date_project_task');
        expect(afterRetry?.indisvalid).toBe(true);
        expect(await indexState(client, 'idx_time_entries_entry_key_unique')).toBeNull();

        const duplicates = await client.query<{ count: number }>(`
        SELECT COUNT(*)::int AS "count"
        FROM "time_entries"
        WHERE "user_id" = 'mig0130_user' AND "task" = 'Dev'
      `);
        expect(duplicates.rows[0]?.count).toBe(2);
      } finally {
        await client
          .query(`DELETE FROM "time_entries" WHERE "user_id" = 'mig0130_user'`)
          .catch(() => undefined);
        await client
          .query(`DELETE FROM "projects" WHERE "id" = 'mig0130_project'`)
          .catch(() => undefined);
        await client
          .query(`DELETE FROM "clients" WHERE "id" = 'mig0130_client'`)
          .catch(() => undefined);
        await client
          .query(`DELETE FROM "users" WHERE "id" = 'mig0130_user'`)
          .catch(() => undefined);
        await client
          .query(`DELETE FROM "roles" WHERE "id" = 'mig0130_role'`)
          .catch(() => undefined);
        client.release();
        await pool.end();
      }
    });
  },
);
