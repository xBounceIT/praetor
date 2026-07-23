import { describe, expect, test } from 'bun:test';
import pg, { type PoolClient } from 'pg';
import { createDbPoolConfig } from '../../db/config.ts';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const SHOULD_SKIP = process.env.RUN_TIME_ENTRY_KEY_MIGRATION_TEST !== '1';
const MIGRATION = readMigrationFile('0121_enforce_time_entry_keys.sql');
const STATEMENTS = MIGRATION.split('--> statement-breakpoint').filter(
  (statement) => statement.trim().length > 0,
);
const CONCURRENT_INDEX_STATEMENT_PATTERN =
  /(?:^|\n)\s*(?:CREATE\s+(?:UNIQUE\s+)?INDEX|DROP\s+INDEX)\s+CONCURRENTLY\b/i;

test('migration 0121 preflights duplicate groups whose exact cost cannot be preserved', () => {
  expect(MIGRATION).toContain('"migration_0121_cost_guard"');
  expect(MIGRATION).toContain('CHECK ("satisfied")');
});

const executeMigrationStatements = async (
  client: PoolClient,
  beforeFirstConcurrentStatement?: () => Promise<void>,
) => {
  let inTransaction = false;
  let reachedConcurrentStatement = false;

  try {
    for (const statement of STATEMENTS) {
      if (CONCURRENT_INDEX_STATEMENT_PATTERN.test(statement)) {
        if (inTransaction) {
          await client.query('COMMIT');
          inTransaction = false;
        }
        if (!reachedConcurrentStatement) {
          reachedConcurrentStatement = true;
          await beforeFirstConcurrentStatement?.();
        }
        await client.query(statement);
        continue;
      }

      if (!inTransaction) {
        await client.query('BEGIN');
        inTransaction = true;
      }
      await client.query(statement);
    }

    if (inTransaction) {
      await client.query('COMMIT');
    }
  } catch (error) {
    if (inTransaction) {
      await client.query('ROLLBACK');
    }
    throw error;
  }
};

describe.skipIf(SHOULD_SKIP)('migration 0121: enforce time-entry keys on legacy data', () => {
  test('consolidates legacy duplicates without ledger loss and rejects new ones', async () => {
    const pool = new pg.Pool(createDbPoolConfig({ max: 1 }));
    const client = await pool.connect();

    try {
      await client.query('DROP INDEX CONCURRENTLY IF EXISTS "idx_time_entries_entry_key_unique"');
      await client.query(`
        INSERT INTO "roles" ("id", "name")
        VALUES ('mig0121_role', 'Migration 0121 Role')
      `);
      await client.query(`
        INSERT INTO "users" (
          "id", "name", "username", "password_hash", "role", "avatar_initials"
        )
        VALUES (
          'mig0121_user', 'Migration User', 'mig0121_user', 'unused',
          'mig0121_role', 'MU'
        )
      `);
      await client.query(`
        INSERT INTO "clients" ("id", "name")
        VALUES ('mig0121_client', 'Migration Client')
      `);
      await client.query(`
        INSERT INTO "projects" ("id", "name", "client_id")
        VALUES ('mig0121_project', 'Migration Project', 'mig0121_client')
      `);

      await client.query(`
        INSERT INTO "time_entries" (
          "id", "user_id", "date", "client_id", "client_name", "project_id",
          "project_name", "task", "duration"
        )
        VALUES
          (
            'mig0121_oversized_a', 'mig0121_user', '2026-07-02', 'mig0121_client',
            'Migration Client', 'mig0121_project', 'Migration Project', 'Oversized', 13
          ),
          (
            'mig0121_oversized_b', 'mig0121_user', '2026-07-02', 'mig0121_client',
            'Migration Client', 'mig0121_project', 'Migration Project', 'Oversized', 13
          )
      `);
      const oversizedGuard = STATEMENTS[0];
      if (!oversizedGuard) throw new Error('Migration 0121 duration guard is missing');
      let oversizedErrorCode: string | undefined;
      try {
        await client.query(oversizedGuard);
      } catch (error) {
        oversizedErrorCode = (error as { code?: string }).code;
      }
      expect(oversizedErrorCode).toBe('23514');
      const oversizedRows = await client.query<{ count: number }>(`
        SELECT COUNT(*)::int AS "count"
        FROM "time_entries"
        WHERE "task" = 'Oversized'
      `);
      expect(oversizedRows.rows[0]?.count).toBe(2);
      await client.query(`DELETE FROM "time_entries" WHERE "task" = 'Oversized'`);

      await client.query(`
        INSERT INTO "time_entries" (
          "id", "user_id", "date", "client_id", "client_name", "project_id",
          "project_name", "task", "duration", "hourly_cost"
        )
        VALUES
          (
            'mig0121_inexact_cost_a', 'mig0121_user', '2026-07-03', 'mig0121_client',
            'Migration Client', 'mig0121_project', 'Migration Project', 'Inexact cost', 1, 10
          ),
          (
            'mig0121_inexact_cost_b', 'mig0121_user', '2026-07-03', 'mig0121_client',
            'Migration Client', 'mig0121_project', 'Migration Project', 'Inexact cost', 1, 10.01
          )
      `);
      let costGuardErrorCode: string | undefined;
      try {
        await client.query(oversizedGuard);
      } catch (error) {
        costGuardErrorCode = (error as { code?: string }).code;
      }
      expect(costGuardErrorCode).toBe('23514');
      const inexactCostRows = await client.query<{ count: number; total_cost: string }>(`
        SELECT
          COUNT(*)::int AS "count",
          SUM("duration" * "hourly_cost") AS "total_cost"
        FROM "time_entries"
        WHERE "task" = 'Inexact cost'
      `);
      expect(inexactCostRows.rows[0]?.count).toBe(2);
      expect(Number(inexactCostRows.rows[0]?.total_cost)).toBe(20.01);
      await client.query(`DELETE FROM "time_entries" WHERE "task" = 'Inexact cost'`);

      await client.query(`
        INSERT INTO "time_entries" (
          "id", "user_id", "date", "client_id", "client_name", "project_id",
          "project_name", "task", "notes", "duration", "hourly_cost",
          "is_placeholder", "version", "created_at"
        )
        VALUES
          (
            'mig0121_moved', 'mig0121_user', '2026-07-01', 'mig0121_client',
            'Migration Client', 'mig0121_project', 'Migration Project', 'Review',
            'Moved details', 2, 30, TRUE, 2, '2026-01-01T00:00:00Z'
          ),
          (
            'mig0121_survivor', 'mig0121_user', '2026-07-01', 'mig0121_client',
            'Migration Client', 'mig0121_project', 'Migration Project', 'Review',
            'Survivor details', 3, 50, FALSE, 1, '2026-01-02T00:00:00Z'
          ),
          (
            'mig0121_late', 'mig0121_user', '2026-07-01', 'mig0121_client',
            'Migration Client', 'mig0121_project', 'Migration Project', 'Review',
            'Late details', 4, 60, FALSE, 1, '2026-01-03T00:00:00Z'
          )
      `);

      let rollingWindowErrorCode: string | undefined;
      try {
        await executeMigrationStatements(client, async () => {
          await client.query(`
            INSERT INTO "time_entries" (
              "id", "user_id", "date", "client_id", "client_name", "project_id",
              "project_name", "task", "notes", "duration", "hourly_cost"
            )
            VALUES (
              'mig0121_window_conflict', 'mig0121_user', '2026-07-01',
              'mig0121_client', 'Migration Client', 'mig0121_project',
              'Migration Project', 'Review', 'Rolling deploy write', 1, 50
            )
          `);
        });
      } catch (error) {
        rollingWindowErrorCode = (error as { code?: string }).code;
      }
      expect(rollingWindowErrorCode).toBe('23505');

      const failedIndex = await client.query<{ indisvalid: boolean }>(`
        SELECT "catalog"."indisvalid"
        FROM "pg_class" AS "class"
        JOIN "pg_index" AS "catalog" ON "catalog"."indexrelid" = "class"."oid"
        WHERE "class"."relname" = 'idx_time_entries_entry_key_unique'
      `);
      expect(failedIndex.rows[0]?.indisvalid).toBe(false);

      // A concurrent build can commit before the migration ledger write. Replaying the whole
      // migration consolidates the racing row into the prior survivor, removes the invalid
      // index, and completes a valid replacement.
      await executeMigrationStatements(client);

      const activeRows = await client.query<{
        id: string;
        duration: string;
        hourly_cost: string;
        notes: string;
        is_placeholder: boolean;
        version: number;
      }>(`
        SELECT "id", "duration", "hourly_cost", "notes", "is_placeholder", "version"
        FROM "time_entries"
        WHERE "user_id" = 'mig0121_user'
        ORDER BY "id"
      `);
      expect(activeRows.rows.map((row) => row.id)).toEqual(['mig0121_survivor']);
      expect(activeRows.rows[0]).toMatchObject({
        duration: '10.00',
        hourly_cost: '50.00',
        notes:
          'Survivor details\n\n---\n\nLate details\n\n---\n\nMoved details\n\n---\n\nRolling deploy write',
        is_placeholder: false,
        version: 3,
      });
      expect(Number(activeRows.rows[0]?.duration) * Number(activeRows.rows[0]?.hourly_cost)).toBe(
        500,
      );

      const archivedRows = await client.query<{
        entity_id: string;
        duplicate_of: string;
        archived_row: { id: string; duration: number | string };
      }>(`
        SELECT
          "entity_id",
          "details" ->> 'duplicateOf' AS "duplicate_of",
          "details" -> 'archivedRow' AS "archived_row"
        FROM "audit_logs"
        WHERE "action" = 'time_entry.migration_duplicate_archived'
          AND "user_id" = 'mig0121_user'
        ORDER BY "entity_id"
      `);
      expect(archivedRows.rows).toHaveLength(3);
      expect(archivedRows.rows.map((row) => row.entity_id)).toEqual([
        'mig0121_late',
        'mig0121_moved',
        'mig0121_window_conflict',
      ]);
      for (const row of archivedRows.rows) {
        expect(row.duplicate_of).toBe('mig0121_survivor');
        expect(row.archived_row.id).toBe(row.entity_id);
      }
      expect(
        Object.fromEntries(
          archivedRows.rows.map((row) => [row.entity_id, Number(row.archived_row.duration)]),
        ),
      ).toEqual({ mig0121_late: 4, mig0121_moved: 2, mig0121_window_conflict: 1 });

      const index = await client.query<{ indexdef: string; indisvalid: boolean }>(`
        SELECT "indexes"."indexdef", "catalog"."indisvalid"
        FROM "pg_indexes" AS "indexes"
        JOIN "pg_class" AS "class" ON "class"."relname" = "indexes"."indexname"
        JOIN "pg_index" AS "catalog" ON "catalog"."indexrelid" = "class"."oid"
        WHERE "indexes"."schemaname" = 'public'
          AND "indexes"."indexname" = 'idx_time_entries_entry_key_unique'
      `);
      expect(index.rows[0]?.indexdef).toContain('UNIQUE INDEX idx_time_entries_entry_key_unique');
      expect(index.rows[0]?.indisvalid).toBe(true);

      let duplicateErrorCode: string | undefined;
      try {
        await client.query(`
          INSERT INTO "time_entries" (
            "id", "user_id", "date", "client_id", "client_name", "project_id",
            "project_name", "task", "duration"
          )
          VALUES (
            'mig0121_rejected', 'mig0121_user', '2026-07-01', 'mig0121_client',
            'Migration Client', 'mig0121_project', 'Migration Project', 'Review', 1
          )
        `);
      } catch (error) {
        duplicateErrorCode = (error as { code?: string }).code;
      }
      expect(duplicateErrorCode).toBe('23505');

      await client.query(`
        DELETE FROM "audit_logs" WHERE "user_id" = 'mig0121_user';
        DELETE FROM "time_entries" WHERE "user_id" = 'mig0121_user';
        DELETE FROM "projects" WHERE "id" = 'mig0121_project';
        DELETE FROM "clients" WHERE "id" = 'mig0121_client';
        DELETE FROM "users" WHERE "id" = 'mig0121_user';
        DELETE FROM "roles" WHERE "id" = 'mig0121_role';
      `);
    } finally {
      client.release();
      await pool.end();
    }
  });
});
