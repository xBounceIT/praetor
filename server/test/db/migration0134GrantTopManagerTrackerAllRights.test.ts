import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const MIGRATION = readMigrationFile('0134_grant_top_manager_tracker_all_rights.sql');

const EXPECTED_PERMISSIONS = [
  'timesheets.tracker_all.view',
  'timesheets.tracker_all.create',
  'timesheets.tracker_all.update',
  'timesheets.tracker_all.delete',
];

const readPermissionTuples = (migration: string) =>
  Array.from(migration.matchAll(/\(\s*'([^']+)',\s*'([^']+)'\s*\)/g), (match) => ({
    roleId: match[1],
    permission: match[2],
  }));

describe('migration 0134: grants global tracker rights to top_manager', () => {
  test('grants the complete tracker_all CRUD permission set', () => {
    expect(readPermissionTuples(MIGRATION)).toEqual(
      EXPECTED_PERMISSIONS.map((permission) => ({ roleId: 'top_manager', permission })),
    );
  });

  test('is retry-safe and skips a missing system role', () => {
    expect(MIGRATION).toMatch(/JOIN roles r ON r\.id = p\.role_id/i);
    expect(MIGRATION).toMatch(/ON CONFLICT DO NOTHING/i);
  });

  test('does not widen any other role', () => {
    expect(MIGRATION).not.toMatch(/\(\s*'(?:manager|user|admin)'\s*,/i);
  });
});
