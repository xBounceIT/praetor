import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as rolesRepo from '../../repositories/rolesRepo.ts';
import { MockExecutor, type TestDb } from '../helpers/MockExecutor.ts';

let exec: MockExecutor;
let testDb: TestDb;

beforeEach(() => {
  exec = new MockExecutor();
  testDb = exec.asTestDb();
});

afterEach(() => {
  exec.reset();
});

describe('findExistingIds', () => {
  test('returns an empty set when no ids are provided', async () => {
    const result = await rolesRepo.findExistingIds([], testDb);
    expect(result.size).toBe(0);
    expect(exec.calls.length).toBe(0);
  });

  test('returns a set of ids that exist in the table', async () => {
    exec.enqueue({
      rows: [
        ['admin'],
        ['manager'],
      ],
    });
    const result = await rolesRepo.findExistingIds(['admin', 'manager', 'ghost'], testDb);
    expect(result.has('admin')).toBe(true);
    expect(result.has('manager')).toBe(true);
    expect(result.has('ghost')).toBe(false);
  });

  test('passes the input ids to the query', async () => {
    exec.enqueue({ rows: [] });
    await rolesRepo.findExistingIds(['admin'], testDb);
    expect(exec.calls[0].params).toEqual(expect.arrayContaining(['admin']));
  });
});

describe('userHasRole', () => {
  test('returns true when the join row exists', async () => {
    exec.enqueue({ rows: [[1]] });
    const result = await rolesRepo.userHasRole('u-1', 'manager', testDb);
    expect(result).toBe(true);
  });

  test('returns false when no row exists', async () => {
    exec.enqueue({ rows: [] });
    const result = await rolesRepo.userHasRole('u-1', 'manager', testDb);
    expect(result).toBe(false);
  });
});

describe('listAvailableRolesForUser', () => {
  test('maps each row through mapRole', async () => {
    exec.enqueue({
      rows: [
        ['admin', 'Admin', true, true],
        ['manager', 'Manager', false, false],
      ],
    });
    const result = await rolesRepo.listAvailableRolesForUser('u-1', testDb);
    expect(result).toEqual([
      { id: 'admin', name: 'Admin', isSystem: true, isAdmin: true },
      { id: 'manager', name: 'Manager', isSystem: false, isAdmin: false },
    ]);
  });

  test('coerces null isSystem/isAdmin to false', async () => {
    exec.enqueue({ rows: [['x', 'X', null, null]] });
    const result = await rolesRepo.listAvailableRolesForUser('u-1', testDb);
    expect(result).toEqual([{ id: 'x', name: 'X', isSystem: false, isAdmin: false }]);
  });
});

describe('listAll', () => {
  test('returns all roles mapped', async () => {
    exec.enqueue({
      rows: [
        ['admin', 'Admin', true, true],
        ['manager', 'Manager', false, false],
        ['user', 'User', false, false],
      ],
    });
    const result = await rolesRepo.listAll(testDb);
    expect(result.length).toBe(3);
    expect(result[0]).toEqual({ id: 'admin', name: 'Admin', isSystem: true, isAdmin: true });
  });

  test('returns an empty list when no rows', async () => {
    exec.enqueue({ rows: [] });
    const result = await rolesRepo.listAll(testDb);
    expect(result).toEqual([]);
  });
});

describe('findById', () => {
  test('returns the role when found', async () => {
    exec.enqueue({ rows: [['admin', 'Admin', true, true]] });
    const result = await rolesRepo.findById('admin', testDb);
    expect(result).toEqual({ id: 'admin', name: 'Admin', isSystem: true, isAdmin: true });
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    const result = await rolesRepo.findById('ghost', testDb);
    expect(result).toBeNull();
  });
});

describe('listExplicitPermissions', () => {
  test('returns an array of permission strings', async () => {
    exec.enqueue({ rows: [['a.b.read'], ['c.d.write']] });
    const result = await rolesRepo.listExplicitPermissions('manager', testDb);
    expect(result).toEqual(['a.b.read', 'c.d.write']);
  });
});

describe('listExplicitPermissionsForRoles', () => {
  test('returns an empty map when no ids', async () => {
    const result = await rolesRepo.listExplicitPermissionsForRoles([], testDb);
    expect(result.size).toBe(0);
    expect(exec.calls.length).toBe(0);
  });

  test('pre-populates the map so every requested id is present', async () => {
    exec.enqueue({
      rows: [
        ['manager', 'a.b.read'],
        ['manager', 'c.d.write'],
      ],
    });
    const result = await rolesRepo.listExplicitPermissionsForRoles(
      ['manager', 'no-perms'],
      testDb,
    );
    expect(result.get('manager')).toEqual(['a.b.read', 'c.d.write']);
    expect(result.get('no-perms')).toEqual([]);
  });

  test('only returns map keys for the requested ids', async () => {
    exec.enqueue({ rows: [['unrequested', 'foo']] });
    const result = await rolesRepo.listExplicitPermissionsForRoles(['manager'], testDb);
    expect(result.get('manager')).toEqual([]);
    expect(result.has('unrequested')).toBe(false);
  });
});

describe('insertRole', () => {
  test('issues an insert into roles', async () => {
    exec.enqueue({ rows: [] });
    await rolesRepo.insertRole('custom-1', 'Custom', testDb);
    expect(exec.calls.length).toBe(1);
    expect(exec.calls[0].params).toEqual(
      expect.arrayContaining(['custom-1', 'Custom']),
    );
  });
});

describe('updateRoleName', () => {
  test('issues an update on roles.name', async () => {
    exec.enqueue({ rows: [] });
    await rolesRepo.updateRoleName('manager', 'Lead', testDb);
    expect(exec.calls[0].params).toEqual(expect.arrayContaining(['manager', 'Lead']));
  });
});

describe('deleteRole', () => {
  test('issues a delete on roles', async () => {
    exec.enqueue({ rows: [] });
    await rolesRepo.deleteRole('manager', testDb);
    expect(exec.calls[0].params).toContain('manager');
  });
});

describe('insertPermission', () => {
  test('issues an insert with the role and permission', async () => {
    exec.enqueue({ rows: [] });
    await rolesRepo.insertPermission('manager', 'a.b.read', testDb);
    expect(exec.calls[0].params).toEqual(
      expect.arrayContaining(['manager', 'a.b.read']),
    );
  });
});

describe('clearPermissions', () => {
  test('issues a delete by role_id', async () => {
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
    exec.enqueue({ rows: [] });
    const result = await rolesRepo.isRoleInUse('manager', testDb);
    expect(result).toBe(false);
  });

  test('returns true when the role appears only in user_roles (secondary assignment)', async () => {
    // No row in `users.role`...
    exec.enqueue({ rows: [] });
    // ...but a row in `user_roles.role_id`. Migration 0025 RESTRICT means deleting this role
    // would error at the DB level, so isRoleInUse must guard the route before that point.
    exec.enqueue({ rows: [[1]] });
    const result = await rolesRepo.isRoleInUse('manager', testDb);
    expect(result).toBe(true);
  });
});
