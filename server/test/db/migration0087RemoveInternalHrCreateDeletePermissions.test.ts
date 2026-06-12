import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

const MIGRATION_SQL = readMigrationFile('0087_remove_internal_hr_create_delete_permissions.sql');

const deletedPermissions = [...MIGRATION_SQL.matchAll(/'([^']+)'/g)].map((match) => match[1]);

describe('0087 remove internal HR create/delete permissions', () => {
  test('deletes internal create/delete permission rows globally', () => {
    expect(MIGRATION_SQL).toContain('DELETE FROM role_permissions');
    expect(deletedPermissions.toSorted()).toEqual(['hr.internal.create', 'hr.internal.delete']);
    expect(MIGRATION_SQL).not.toMatch(/role_id\s+IN/i);
  });

  test('leaves internal view/update and external grants out of the delete list', () => {
    expect(deletedPermissions).not.toContain('hr.internal.view');
    expect(deletedPermissions).not.toContain('hr.internal.update');
    expect(deletedPermissions).not.toContain('hr.external.create');
    expect(deletedPermissions).not.toContain('hr.external.delete');
  });
});
