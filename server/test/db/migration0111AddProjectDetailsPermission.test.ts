import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

describe('migration 0111: add project details permission', () => {
  const MIGRATION = readMigrationFile('0111_add_project_details_permission.sql');

  test('grants advanced project data only to the shipped manager roles', () => {
    expect(MIGRATION).toContain("'projects.details.view'");
    expect(MIGRATION).toContain("IN ('manager', 'top_manager')");
    expect(MIGRATION).toContain('COALESCE("roles"."is_system", false) = true');
    expect(MIGRATION).not.toMatch(/\('user',\s*'projects\.details\.view'\)/);
    expect(MIGRATION).not.toMatch(/\('admin',\s*'projects\.details\.view'\)/);
  });

  test('is idempotent for already-upgraded role permissions', () => {
    expect(MIGRATION).toContain('ON CONFLICT ("role_id", "permission") DO NOTHING');
  });
});
