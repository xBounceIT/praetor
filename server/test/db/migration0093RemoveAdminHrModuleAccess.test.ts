import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const MIGRATION_SQL = readMigrationFile('0093_remove_admin_hr_module_access.sql');

describe('0093 remove admin HR module access', () => {
  test('deletes HR permissions from only the built-in admin role', () => {
    expect(MIGRATION_SQL).toContain('DELETE FROM role_permissions');
    expect(MIGRATION_SQL).toMatch(/role_id\s*=\s*'admin'/i);
    expect(MIGRATION_SQL).toMatch(/permission\s+LIKE\s+'hr\.%'/i);
  });

  test('does not target manager, top_manager, or custom roles', () => {
    expect(MIGRATION_SQL).not.toMatch(/role_id\s+IN/i);
    expect(MIGRATION_SQL).not.toContain("'manager'");
    expect(MIGRATION_SQL).not.toContain("'top_manager'");
  });
});
