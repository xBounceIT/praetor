import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const MIGRATION_SQL = readMigrationFile('0072_grant_expired_project_time_entry_permission.sql');
const SCHEMA_SQL = readFileSync(join(import.meta.dirname, '..', '..', 'db', 'schema.sql'), 'utf-8');

const EXPECTED_VALUES = [
  "('manager', 'timesheets.expired_projects.create')",
  "('top_manager', 'timesheets.expired_projects.create')",
];

describe('0072 grant expired-project time-entry permission', () => {
  test('migration grants the override to manager and top_manager only', () => {
    for (const value of EXPECTED_VALUES) expect(MIGRATION_SQL).toContain(value);
    expect(MIGRATION_SQL).toContain('ON CONFLICT DO NOTHING');
    expect(MIGRATION_SQL).not.toContain("('user', 'timesheets.expired_projects.create')");
  });

  test('fresh-install schema seeds the same default grants', () => {
    for (const value of EXPECTED_VALUES) expect(SCHEMA_SQL).toContain(value);
  });
});
