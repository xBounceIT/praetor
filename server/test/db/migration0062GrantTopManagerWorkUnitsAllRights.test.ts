import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

// Migration 0062 completes the default Top Manager grants for Competence
// Centers. It intentionally writes every hr.work_units and hr.work_units_all
// permission so old installs missing any single grant converge to the default.

const EXPECTED_PERMISSIONS = [
  'hr.work_units.view',
  'hr.work_units.create',
  'hr.work_units.update',
  'hr.work_units.delete',
  'hr.work_units_all.view',
  'hr.work_units_all.create',
  'hr.work_units_all.update',
  'hr.work_units_all.delete',
];

const readPermissionTuples = (migration: string) =>
  Array.from(migration.matchAll(/\(\s*'([^']+)',\s*'([^']+)'\s*\)/g), (match) => ({
    roleId: match[1],
    permission: match[2],
  }));

describe('migration 0062: grants all competence-center rights to top_manager', () => {
  const MIGRATION = readMigrationFile('0062_grant_top_manager_work_units_all_rights.sql');

  test('grants both base and all-scope work-unit CRUD to top_manager', () => {
    for (const permission of EXPECTED_PERMISSIONS) {
      expect(MIGRATION).toContain(`('top_manager', '${permission}')`);
    }
  });

  test('is idempotent and skips missing system roles without FK failures', () => {
    expect(MIGRATION).toMatch(/ON CONFLICT DO NOTHING/i);
    expect(MIGRATION).toMatch(/JOIN roles r ON r\.id = p\.role_id/i);
  });

  test('only writes top_manager work-unit permission tuples', () => {
    expect(readPermissionTuples(MIGRATION)).toEqual(
      EXPECTED_PERMISSIONS.map((permission) => ({ roleId: 'top_manager', permission })),
    );
  });
});
