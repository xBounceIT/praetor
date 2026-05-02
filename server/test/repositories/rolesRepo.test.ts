import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as rolesRepo from '../../repositories/rolesRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

describe('findExistingIds', () => {
  test('returns an empty Set without firing SQL when ids is empty', async () => {
    const result = await rolesRepo.findExistingIds([], testDb);
    expect(result.size).toBe(0);
    expect(exec.calls).toHaveLength(0);
  });

  test('passes the ids in the query params', async () => {
    exec.enqueue({ rows: [['a'], ['b']] });
    await rolesRepo.findExistingIds(['a', 'b'], testDb);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].params).toContain('a');
    expect(exec.calls[0].params).toContain('b');
  });

  test('returns a Set of the ids the DB confirmed', async () => {
    exec.enqueue({ rows: [['a'], ['b']] });
    const result = await rolesRepo.findExistingIds(['a', 'b'], testDb);
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.size).toBe(2);
  });

  test('returns only the ids the DB confirmed, not the inputs', async () => {
    exec.enqueue({ rows: [['a']] });
    const result = await rolesRepo.findExistingIds(['a', 'b', 'c'], testDb);
    expect(result.size).toBe(1);
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(false);
    expect(result.has('c')).toBe(false);
  });
});

describe('userHasRole', () => {
  test('returns true when the DB returns a row', async () => {
    exec.enqueue({ rows: [[1]] });
    const result = await rolesRepo.userHasRole('user-1', 'manager', testDb);
    expect(result).toBe(true);
    expect(exec.calls[0].params).toContain('user-1');
    expect(exec.calls[0].params).toContain('manager');
  });

  test('returns false when no row is returned', async () => {
    exec.enqueue({ rows: [] });
    const result = await rolesRepo.userHasRole('user-1', 'manager', testDb);
    expect(result).toBe(false);
  });
});

describe('listAvailableRolesForUser', () => {
  test('joins user_roles to roles and passes userId in params', async () => {
    exec.enqueue({
      rows: [
        ['admin', 'Admin', true, true],
        ['manager', 'Manager', false, false],
      ],
    });
    const result = await rolesRepo.listAvailableRolesForUser('user-1', testDb);
    expect(result).toEqual([
      { id: 'admin', name: 'Admin', isSystem: true, isAdmin: true },
      { id: 'manager', name: 'Manager', isSystem: false, isAdmin: false },
    ]);
    expect(exec.calls[0].params).toContain('user-1');
    expect(exec.calls[0].sql.toLowerCase()).toContain('inner join "roles"');
  });

  test('returns an empty array when the user has no roles', async () => {
    exec.enqueue({ rows: [] });
    const result = await rolesRepo.listAvailableRolesForUser('user-1', testDb);
    expect(result).toEqual([]);
  });
});

describe('listAll', () => {
  test('returns rows mapped to Role and orders by name', async () => {
    exec.enqueue({
      rows: [
        ['admin', 'Admin', true, true],
        ['manager', 'Manager', false, false],
      ],
    });
    const result = await rolesRepo.listAll(testDb);
    expect(result).toEqual([
      { id: 'admin', name: 'Admin', isSystem: true, isAdmin: true },
      { id: 'manager', name: 'Manager', isSystem: false, isAdmin: false },
    ]);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].sql.toLowerCase()).toContain('order by "roles"."name"');
  });

  test('coerces null is_system / is_admin to false', async () => {
    exec.enqueue({ rows: [['custom', 'Custom', null, null]] });
    const [result] = await rolesRepo.listAll(testDb);
    expect(result.isSystem).toBe(false);
    expect(result.isAdmin).toBe(false);
  });
});

describe('findById', () => {
  test('returns the mapped row when found', async () => {
    exec.enqueue({ rows: [['manager', 'Manager', false, false]] });
    const result = await rolesRepo.findById('manager', testDb);
    expect(result).toEqual({ id: 'manager', name: 'Manager', isSystem: false, isAdmin: false });
    expect(exec.calls[0].params).toContain('manager');
  });

  test('returns null when the row does not exist', async () => {
    exec.enqueue({ rows: [] });
    const result = await rolesRepo.findById('missing', testDb);
    expect(result).toBeNull();
  });
});

describe('listExplicitPermissions', () => {
  test('returns the permission strings in row order', async () => {
    exec.enqueue({ rows: [['projects.view'], ['clients.update']] });
    const result = await rolesRepo.listExplicitPermissions('manager', testDb);
    expect(result).toEqual(['projects.view', 'clients.update']);
    expect(exec.calls[0].params).toContain('manager');
  });

  test('returns an empty array when the role has no explicit permissions', async () => {
    exec.enqueue({ rows: [] });
    const result = await rolesRepo.listExplicitPermissions('manager', testDb);
    expect(result).toEqual([]);
  });
});

describe('listExplicitPermissionsForRoles', () => {
  test('returns an empty Map without firing SQL when roleIds is empty', async () => {
    const result = await rolesRepo.listExplicitPermissionsForRoles([], testDb);
    expect(result.size).toBe(0);
    expect(exec.calls).toHaveLength(0);
  });

  test('passes roleIds in the query params', async () => {
    exec.enqueue({ rows: [] });
    await rolesRepo.listExplicitPermissionsForRoles(['a', 'b'], testDb);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].params).toContain('a');
    expect(exec.calls[0].params).toContain('b');
  });

  test('groups permissions by role and preserves DB row order within each role', async () => {
    exec.enqueue({
      rows: [
        ['manager', 'projects.view'],
        ['auditor', 'reports.view'],
        ['manager', 'clients.update'],
      ],
    });
    const result = await rolesRepo.listExplicitPermissionsForRoles(['manager', 'auditor'], testDb);
    expect(result.get('manager')).toEqual(['projects.view', 'clients.update']);
    expect(result.get('auditor')).toEqual(['reports.view']);
  });

  test('roles with no permissions are still present in the Map with empty arrays', async () => {
    exec.enqueue({ rows: [['manager', 'projects.view']] });
    const result = await rolesRepo.listExplicitPermissionsForRoles(
      ['manager', 'empty-role'],
      testDb,
    );
    expect(result.get('manager')).toEqual(['projects.view']);
    expect(result.get('empty-role')).toEqual([]);
  });
});

describe('insertRole', () => {
  test('passes id and name and inserts is_system/is_admin as false', async () => {
    exec.enqueue({ rows: [] });
    await rolesRepo.insertRole('role_xyz', 'Custom', testDb);
    expect(exec.calls[0].params).toContain('role_xyz');
    expect(exec.calls[0].params).toContain('Custom');
    expect(exec.calls[0].params).toContain(false);
    expect(exec.calls[0].sql.toLowerCase()).toContain('insert into "roles"');
  });
});

describe('updateRoleName', () => {
  test('passes name and id', async () => {
    exec.enqueue({ rows: [] });
    await rolesRepo.updateRoleName('role_xyz', 'Renamed', testDb);
    expect(exec.calls[0].params).toContain('Renamed');
    expect(exec.calls[0].params).toContain('role_xyz');
  });
});

describe('deleteRole', () => {
  test('passes id', async () => {
    exec.enqueue({ rows: [] });
    await rolesRepo.deleteRole('role_xyz', testDb);
    expect(exec.calls[0].params).toContain('role_xyz');
  });
});

describe('insertPermission', () => {
  test('passes roleId and permission and uses ON CONFLICT DO NOTHING', async () => {
    exec.enqueue({ rows: [] });
    await rolesRepo.insertPermission('manager', 'projects.view', testDb);
    expect(exec.calls[0].params).toContain('manager');
    expect(exec.calls[0].params).toContain('projects.view');
    expect(exec.calls[0].sql.toLowerCase()).toContain('on conflict do nothing');
  });
});

describe('clearPermissions', () => {
  test('passes roleId', async () => {
    exec.enqueue({ rows: [] });
    await rolesRepo.clearPermissions('manager', testDb);
    expect(exec.calls[0].params).toContain('manager');
  });
});

describe('isRoleInUse', () => {
  test('returns true when at least one user has the role', async () => {
    exec.enqueue({ rows: [[1]] });
    const result = await rolesRepo.isRoleInUse('manager', testDb);
    expect(result).toBe(true);
    expect(exec.calls[0].params).toContain('manager');
  });

  test('returns false when no user has the role', async () => {
    exec.enqueue({ rows: [] });
    const result = await rolesRepo.isRoleInUse('manager', testDb);
    expect(result).toBe(false);
  });
});
