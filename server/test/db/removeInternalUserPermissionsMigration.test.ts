import { describe, expect, test } from 'bun:test';
import { readMigrationFile } from '../helpers/schemaFiles.ts';

// Migration 0056 strips the ability to CREATE and DELETE internal users from
// the default Manager and Top Manager roles. The create/delete user routes gate
// employee_type = 'internal' behind hr.internal.create / hr.internal.delete, so
// this guards that the data migration removes exactly those grants from exactly
// those two roles and leaves view/update plus the external set untouched.

const MIGRATION_SQL = readMigrationFile(
  '0056_remove_internal_user_create_delete_from_default_managers.sql',
);

const extractInList = (clause: string): string[] => {
  const match = MIGRATION_SQL.match(new RegExp(`${clause}\\s+IN\\s*\\(([^)]*)\\)`, 'i'));
  if (!match) return [];
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

// Parse the DELETE's targets once: which roles it scopes to and which
// permissions it strips.
const deletedRoles = extractInList('role_id');
const deletedPermissions = new Set(extractInList('permission'));

// The full hr.* grant set that the schema.sql bootstrap seeds for 'manager' and
// that 'top_manager' inherits from the manager baseline.
const SEEDED_HR_PERMISSIONS = [
  'hr.internal.view',
  'hr.internal.create',
  'hr.internal.update',
  'hr.internal.delete',
  'hr.external.view',
  'hr.external.create',
  'hr.external.update',
  'hr.external.delete',
];

// Simulate the migration's scoped DELETE for a single role: only roles named in
// the WHERE clause lose the targeted permissions, so a role the migration does
// not target keeps its full seeded set.
const applyMigration = (role: string, permissions: string[]): string[] =>
  deletedRoles.includes(role)
    ? permissions.filter((permission) => !deletedPermissions.has(permission))
    : [...permissions];

describe('0056 remove internal-user create/delete from default managers', () => {
  test('targets only the manager and top_manager roles', () => {
    expect([...deletedRoles].sort()).toEqual(['manager', 'top_manager']);
  });

  test('deletes exactly hr.internal.create and hr.internal.delete', () => {
    expect([...deletedPermissions].sort()).toEqual(['hr.internal.create', 'hr.internal.delete']);
  });

  for (const role of ['manager', 'top_manager']) {
    test(`${role} loses internal create/delete but keeps view/update and all external grants`, () => {
      const result = applyMigration(role, SEEDED_HR_PERMISSIONS);

      expect(result).not.toContain('hr.internal.create');
      expect(result).not.toContain('hr.internal.delete');
      expect(result).toContain('hr.internal.view');
      expect(result).toContain('hr.internal.update');
      expect(result).toContain('hr.external.view');
      expect(result).toContain('hr.external.create');
      expect(result).toContain('hr.external.update');
      expect(result).toContain('hr.external.delete');
    });
  }

  test('leaves untargeted roles untouched', () => {
    expect(applyMigration('user', SEEDED_HR_PERMISSIONS)).toEqual(SEEDED_HR_PERMISSIONS);
  });

  test('does not touch external or administration grants', () => {
    expect([...deletedPermissions].some((p) => p.startsWith('administration.'))).toBe(false);
    expect([...deletedPermissions].some((p) => p.startsWith('hr.external.'))).toBe(false);
  });
});
