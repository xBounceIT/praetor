import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const MIGRATION = readMigrationFile('0130_allow_duplicate_time_entry_keys.sql');

describe('migration 0130 allow duplicate time entry keys', () => {
  test('drops unique and replacement indexes concurrently before rebuild', () => {
    expect(MIGRATION).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "idx_time_entries_entry_key_unique"',
    );
    expect(MIGRATION).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "idx_time_entries_user_date_project_task"',
    );
    expect(MIGRATION).toContain(
      'CREATE INDEX CONCURRENTLY "idx_time_entries_user_date_project_task"',
    );
    expect(MIGRATION).not.toContain('CREATE UNIQUE INDEX');
    expect(MIGRATION).not.toMatch(
      /CREATE INDEX(?!\s+CONCURRENTLY)\s+(?:IF NOT EXISTS\s+)?"idx_time_entries_user_date_project_task"/,
    );
  });
});
