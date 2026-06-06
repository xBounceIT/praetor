import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const MIGRATION_SQL = readMigrationFile('0074_grant_expired_project_time_entry_permission.sql');

describe('0074 grant expired-project time-entry permission', () => {
  test('migration grants the override to existing manager and top_manager roles only', () => {
    expect(MIGRATION_SQL).toContain("SELECT roles.id, 'timesheets.expired_projects.create'");
    expect(MIGRATION_SQL).toContain("WHERE roles.id IN ('manager', 'top_manager')");
    expect(MIGRATION_SQL).toContain('ON CONFLICT DO NOTHING');
    expect(MIGRATION_SQL).not.toContain("('user', 'timesheets.expired_projects.create')");
  });
});
