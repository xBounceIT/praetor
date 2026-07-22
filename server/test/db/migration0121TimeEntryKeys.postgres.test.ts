import { describe, expect, test } from 'bun:test';
import pg from 'pg';
import { createDbPoolConfig } from '../../db/config.ts';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const SHOULD_SKIP = process.env.RUN_TIME_ENTRY_KEY_MIGRATION_TEST !== '1';
const MIGRATION = readMigrationFile('0121_enforce_time_entry_keys.sql');
const STATEMENTS = MIGRATION.split('--> statement-breakpoint').filter(
  (statement) => statement.trim().length > 0,
);

describe.skipIf(SHOULD_SKIP)('migration 0121: enforce time-entry keys on legacy data', () => {
  test('archives legacy duplicates, keeps the deterministic survivor, and rejects new ones', async () => {
    const pool = new pg.Pool(createDbPoolConfig({ max: 1 }));
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('DROP INDEX "idx_time_entries_entry_key_unique"');
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
          "project_name", "task", "duration", "version", "created_at"
        )
        VALUES
          (
            'mig0121_moved', 'mig0121_user', '2026-07-01', 'mig0121_client',
            'Migration Client', 'mig0121_project', 'Migration Project', 'Review',
            2, 2, '2026-01-01T00:00:00Z'
          ),
          (
            'mig0121_survivor', 'mig0121_user', '2026-07-01', 'mig0121_client',
            'Migration Client', 'mig0121_project', 'Migration Project', 'Review',
            3, 1, '2026-01-02T00:00:00Z'
          ),
          (
            'mig0121_late', 'mig0121_user', '2026-07-01', 'mig0121_client',
            'Migration Client', 'mig0121_project', 'Migration Project', 'Review',
            4, 1, '2026-01-03T00:00:00Z'
          )
      `);

      for (const statement of STATEMENTS) {
        await client.query(statement);
      }

      const activeRows = await client.query<{ id: string }>(`
        SELECT "id"
        FROM "time_entries"
        WHERE "user_id" = 'mig0121_user'
        ORDER BY "id"
      `);
      expect(activeRows.rows.map((row) => row.id)).toEqual(['mig0121_survivor']);

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
      expect(archivedRows.rows).toHaveLength(2);
      expect(archivedRows.rows.map((row) => row.entity_id)).toEqual([
        'mig0121_late',
        'mig0121_moved',
      ]);
      for (const row of archivedRows.rows) {
        expect(row.duplicate_of).toBe('mig0121_survivor');
        expect(row.archived_row.id).toBe(row.entity_id);
      }
      expect(
        Object.fromEntries(
          archivedRows.rows.map((row) => [row.entity_id, Number(row.archived_row.duration)]),
        ),
      ).toEqual({ mig0121_late: 4, mig0121_moved: 2 });

      const index = await client.query<{ indexdef: string }>(`
        SELECT "indexdef"
        FROM "pg_indexes"
        WHERE "schemaname" = 'public'
          AND "indexname" = 'idx_time_entries_entry_key_unique'
      `);
      expect(index.rows[0]?.indexdef).toContain('UNIQUE INDEX idx_time_entries_entry_key_unique');

      await client.query('SAVEPOINT duplicate_insert');
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
      await client.query('ROLLBACK TO SAVEPOINT duplicate_insert');
      expect(duplicateErrorCode).toBe('23505');
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });
});
