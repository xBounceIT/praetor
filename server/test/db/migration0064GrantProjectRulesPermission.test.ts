import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

describe('migration 0064: grants project rule permissions', () => {
  const MIGRATION = readMigrationFile('0064_grant_projects_rules_permission.sql');

  test('grants CRUD project rule permissions to manager and top_manager roles', () => {
    for (const role of ['manager', 'top_manager']) {
      for (const action of ['view', 'create', 'update', 'delete']) {
        expect(MIGRATION).toContain(`('${role}', 'projects.rules.${action}')`);
      }
    }
  });

  test('uses INSERT...SELECT with role join and ON CONFLICT for fresh-db safety', () => {
    expect(MIGRATION).toMatch(/INSERT INTO role_permissions \(role_id, permission\)/i);
    expect(MIGRATION).toMatch(/JOIN roles r ON r\.id = p\.role_id/i);
    expect(MIGRATION).toMatch(/ON CONFLICT DO NOTHING/i);
  });
});
