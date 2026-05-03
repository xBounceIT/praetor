import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as usersRepo from '../../repositories/usersRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// Most user-management list functions (listAllForAdmin/listScopedForManager/findById) use
// executeRows with raw SQL — rows come back with camelCase keys via SELECT aliases. Other
// functions use the Drizzle query builder (rowMode: 'array' positional rows in projection
// declaration order).

describe('getPasswordHash', () => {
  test('returns the hash when the row exists', async () => {
    exec.enqueue({ rows: [['$2b$10$abc']] });
    const result = await usersRepo.getPasswordHash('user-1', testDb);
    expect(result).toBe('$2b$10$abc');
    expect(exec.calls[0].params).toContain('user-1');
  });

  test('returns null when no row exists', async () => {
    exec.enqueue({ rows: [] });
    expect(await usersRepo.getPasswordHash('user-1', testDb)).toBeNull();
  });

  test('returns null when the row exists but passwordHash is null', async () => {
    exec.enqueue({ rows: [[null]] });
    expect(await usersRepo.getPasswordHash('user-1', testDb)).toBeNull();
  });
});

describe('findAuthUserById', () => {
  test('returns the mapped user when the row exists', async () => {
    // Projection: id, name, username, role, avatarInitials, isDisabled
    exec.enqueue({ rows: [['user-1', 'Alice', 'alice', 'manager', 'AL', false]] });
    const result = await usersRepo.findAuthUserById('user-1', testDb);
    expect(result).toEqual({
      id: 'user-1',
      name: 'Alice',
      username: 'alice',
      role: 'manager',
      avatarInitials: 'AL',
      isDisabled: false,
    });
    expect(exec.calls[0].params).toContain('user-1');
  });

  test('returns null when no row exists', async () => {
    exec.enqueue({ rows: [] });
    expect(await usersRepo.findAuthUserById('user-1', testDb)).toBeNull();
  });
});

describe('findLoginUserByUsername', () => {
  test('returns the mapped login user when the row exists', async () => {
    // Projection: id, name, username, role, passwordHash, avatarInitials, isDisabled
    exec.enqueue({
      rows: [['user-1', 'Alice', 'alice', 'manager', '$2b$10$abc', 'AL', false]],
    });
    const result = await usersRepo.findLoginUserByUsername('alice', testDb);
    expect(result).toEqual({
      id: 'user-1',
      name: 'Alice',
      username: 'alice',
      role: 'manager',
      passwordHash: '$2b$10$abc',
      avatarInitials: 'AL',
      isDisabled: false,
    });
    expect(exec.calls[0].params).toContain('alice');
  });

  test('returns null when no row exists', async () => {
    exec.enqueue({ rows: [] });
    expect(await usersRepo.findLoginUserByUsername('alice', testDb)).toBeNull();
  });
});

describe('updatePasswordHash', () => {
  test('passes the hash and userId in params', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    await usersRepo.updatePasswordHash('user-1', 'new-hash', testDb);
    expect(exec.calls[0].params).toContain('new-hash');
    expect(exec.calls[0].params).toContain('user-1');
  });

  test('resolves to undefined', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    const result = await usersRepo.updatePasswordHash('user-1', 'new-hash', testDb);
    expect(result).toBeUndefined();
  });
});

describe('findCostPerHour', () => {
  test('parses string-encoded numerics from pg', async () => {
    exec.enqueue({ rows: [['42.5']] });
    expect(await usersRepo.findCostPerHour('user-1', testDb)).toBe(42.5);
  });

  test('passes numeric values through unchanged', async () => {
    exec.enqueue({ rows: [[42.5]] });
    expect(await usersRepo.findCostPerHour('user-1', testDb)).toBe(42.5);
  });

  test('returns 0 when row missing', async () => {
    exec.enqueue({ rows: [] });
    expect(await usersRepo.findCostPerHour('user-1', testDb)).toBe(0);
  });

  test('returns 0 when costPerHour is null', async () => {
    exec.enqueue({ rows: [[null]] });
    expect(await usersRepo.findCostPerHour('user-1', testDb)).toBe(0);
  });

  test('returns 0 when string is unparseable', async () => {
    exec.enqueue({ rows: [['oops']] });
    expect(await usersRepo.findCostPerHour('user-1', testDb)).toBe(0);
  });
});

describe('updateNameByUsername', () => {
  test('passes the username and name in params', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    await usersRepo.updateNameByUsername('alice', 'Alice Smith', testDb);
    expect(exec.calls[0].params).toContain('alice');
    expect(exec.calls[0].params).toContain('Alice Smith');
  });
});

describe('createUser', () => {
  test('passes id, name, username, passwordHash, role, avatarInitials in params', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    await usersRepo.createUser(
      {
        id: 'user-1',
        name: 'Alice Smith',
        username: 'alice',
        passwordHash: '$2a$10$placeholder',
        role: 'user',
        avatarInitials: 'AS',
      },
      testDb,
    );
    expect(exec.calls[0].params).toContain('user-1');
    expect(exec.calls[0].params).toContain('Alice Smith');
    expect(exec.calls[0].params).toContain('alice');
    expect(exec.calls[0].params).toContain('$2a$10$placeholder');
    expect(exec.calls[0].params).toContain('user');
    expect(exec.calls[0].params).toContain('AS');
  });
});

// ===========================================================================
// User-management endpoint coverage
// ===========================================================================

const sampleListRow = {
  id: 'user-1',
  name: 'Alice',
  username: 'alice',
  email: 'alice@example.com',
  role: 'manager',
  avatarInitials: 'AL',
  costPerHour: '42.5',
  isDisabled: false,
  employeeType: 'app_user',
  hasTopManagerRole: false,
  isAdminOnly: false,
};

describe('listAllForAdmin', () => {
  test('binds the role-flag constants and maps rows', async () => {
    exec.enqueue({ rows: [sampleListRow] });
    const result = await usersRepo.listAllForAdmin(testDb);
    expect(exec.calls[0].params).toEqual(['top_manager', 'admin', 'admin']);
    expect(result).toEqual([
      {
        id: 'user-1',
        name: 'Alice',
        username: 'alice',
        email: 'alice@example.com',
        role: 'manager',
        avatarInitials: 'AL',
        costPerHour: 42.5,
        isDisabled: false,
        employeeType: 'app_user',
        hasTopManagerRole: false,
        isAdminOnly: false,
      },
    ]);
  });

  test('coerces null email and avatarInitials to empty string', async () => {
    exec.enqueue({
      rows: [{ ...sampleListRow, email: null, avatarInitials: null, employeeType: null }],
    });
    const [user] = await usersRepo.listAllForAdmin(testDb);
    expect(user.email).toBe('');
    expect(user.avatarInitials).toBe('');
    expect(user.employeeType).toBe('app_user');
  });
});

describe('listScopedForManager', () => {
  test('always includes the self condition; OR-joins enabled scope conditions', async () => {
    exec.enqueue({ rows: [] });
    await usersRepo.listScopedForManager(
      'viewer-1',
      { canViewManagedUsers: true, canViewInternal: true, canViewExternal: false },
      testDb,
    );
    const sql = exec.calls[0].sql;
    expect(sql).toContain('u.id =');
    expect(sql).toContain('wum.user_id =');
    expect(sql).toContain("u.employee_type = 'internal'");
    expect(sql).not.toContain("u.employee_type = 'external'");
    expect(exec.calls[0].params).toContain('viewer-1');
  });

  test('hides top managers from results via NOT EXISTS', async () => {
    exec.enqueue({ rows: [] });
    await usersRepo.listScopedForManager(
      'viewer-1',
      { canViewManagedUsers: false, canViewInternal: false, canViewExternal: false },
      testDb,
    );
    expect(exec.calls[0].sql).toContain('NOT EXISTS');
    expect(exec.calls[0].params).toContain('top_manager');
  });
});

describe('findById', () => {
  test('passes id and maps the row', async () => {
    exec.enqueue({ rows: [sampleListRow] });
    const result = await usersRepo.findById('user-1', testDb);
    expect(exec.calls[0].params).toContain('user-1');
    expect(result?.id).toBe('user-1');
  });

  test('returns null when no row exists', async () => {
    exec.enqueue({ rows: [] });
    expect(await usersRepo.findById('user-1', testDb)).toBeNull();
  });
});

describe('findCoreById', () => {
  test('returns the mapped core user when the row exists', async () => {
    // Projection: id, name, username, role, employeeType
    exec.enqueue({ rows: [['user-1', 'Alice', 'alice', 'manager', 'internal']] });
    const result = await usersRepo.findCoreById('user-1', testDb);
    expect(result).toEqual({
      id: 'user-1',
      name: 'Alice',
      username: 'alice',
      role: 'manager',
      employeeType: 'internal',
    });
    expect(exec.calls[0].params).toContain('user-1');
  });

  test('defaults employeeType to app_user when null', async () => {
    exec.enqueue({ rows: [['user-1', 'Alice', 'alice', 'manager', null]] });
    const result = await usersRepo.findCoreById('user-1', testDb);
    expect(result?.employeeType).toBe('app_user');
  });

  test('returns null when no row exists', async () => {
    exec.enqueue({ rows: [] });
    expect(await usersRepo.findCoreById('user-1', testDb)).toBeNull();
  });
});

describe('existsByUsername', () => {
  test.each([
    [[['u1']], true],
    [[], false],
  ] as const)('returns %s when query returns %j rows', async (rows, expected) => {
    exec.enqueue({ rows: [...rows] });
    expect(await usersRepo.existsByUsername('alice', testDb)).toBe(expected);
    expect(exec.calls[0].params).toContain('alice');
  });
});

describe('insertUser', () => {
  test('passes all 9 columns', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    await usersRepo.insertUser(
      {
        id: 'user-1',
        name: 'Alice',
        username: 'alice',
        passwordHash: '$2b$10$x',
        role: 'user',
        avatarInitials: 'AL',
        costPerHour: 42,
        isDisabled: false,
        employeeType: 'internal',
      },
      testDb,
    );
    expect(exec.calls[0].params).toContain('user-1');
    expect(exec.calls[0].params).toContain('Alice');
    expect(exec.calls[0].params).toContain('alice');
    expect(exec.calls[0].params).toContain('$2b$10$x');
    expect(exec.calls[0].params).toContain('user');
    expect(exec.calls[0].params).toContain('AL');
    // Drizzle stringifies numeric column values before passing to pg.
    expect(exec.calls[0].params).toContain('42');
    expect(exec.calls[0].params).toContain(false);
    expect(exec.calls[0].params).toContain('internal');
  });
});

describe('deleteById', () => {
  test('returns true when a row is returned', async () => {
    exec.enqueue({ rows: [['user-1']] });
    expect(await usersRepo.deleteById('user-1', testDb)).toBe(true);
  });

  test('returns false when no row matched', async () => {
    exec.enqueue({ rows: [] });
    expect(await usersRepo.deleteById('user-1', testDb)).toBe(false);
  });

  test('passes id to the query', async () => {
    exec.enqueue({ rows: [['user-1']] });
    await usersRepo.deleteById('user-1', testDb);
    expect(exec.calls[0].params).toContain('user-1');
  });
});

describe('updateUserDynamic', () => {
  test('returns null without issuing a query when no fields are provided', async () => {
    const result = await usersRepo.updateUserDynamic('user-1', {}, testDb);
    expect(result).toBeNull();
    expect(exec.calls.length).toBe(0);
  });

  test('builds a SET clause containing only the provided fields', async () => {
    // RETURNING projection: id, name, username, role, avatarInitials, costPerHour, isDisabled,
    // employeeType
    exec.enqueue({
      rows: [['user-1', 'Alice', 'alice', 'user', 'AL', '50', true, 'app_user']],
      rowCount: 1,
    });
    await usersRepo.updateUserDynamic(
      'user-1',
      { name: 'Alice', isDisabled: true, costPerHour: 50, role: 'user' },
      testDb,
    );
    const sql = exec.calls[0].sql.toLowerCase();
    // Drizzle reorders SET assignments to schema column declaration order, not the order
    // they were added to the partial-set object.
    expect(sql).toContain('"name"');
    expect(sql).toContain('"is_disabled"');
    expect(sql).toContain('"cost_per_hour"');
    expect(sql).toContain('"role"');
    expect(exec.calls[0].params).toContain('Alice');
    expect(exec.calls[0].params).toContain(true);
    expect(exec.calls[0].params).toContain('50');
    expect(exec.calls[0].params).toContain('user');
    expect(exec.calls[0].params).toContain('user-1');
  });

  test('returns null when no row was updated', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    const result = await usersRepo.updateUserDynamic('user-1', { name: 'Alice' }, testDb);
    expect(result).toBeNull();
  });

  test('parses cost_per_hour from string into number on the returned row', async () => {
    exec.enqueue({
      rows: [['user-1', 'Alice', 'alice', 'user', 'AL', '17.25', false, 'app_user']],
      rowCount: 1,
    });
    const result = await usersRepo.updateUserDynamic('user-1', { name: 'Alice' }, testDb);
    expect(result?.costPerHour).toBe(17.25);
  });
});

describe('addUserRole / clearUserRoles / setPrimaryRole', () => {
  test('addUserRole inserts ON CONFLICT DO NOTHING', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    await usersRepo.addUserRole('user-1', 'manager', testDb);
    expect(exec.calls[0].sql).toContain('ON CONFLICT DO NOTHING');
    expect(exec.calls[0].params).toContain('user-1');
    expect(exec.calls[0].params).toContain('manager');
  });

  test('clearUserRoles deletes all rows for the user', async () => {
    exec.enqueue({ rows: [], rowCount: 3 });
    await usersRepo.clearUserRoles('user-1', testDb);
    expect(exec.calls[0].sql).toContain('DELETE FROM user_roles');
    expect(exec.calls[0].params).toContain('user-1');
  });

  test('setPrimaryRole updates the role column', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    await usersRepo.setPrimaryRole('user-1', 'manager', testDb);
    expect(exec.calls[0].params).toContain('manager');
    expect(exec.calls[0].params).toContain('user-1');
  });
});

describe('replaceUserRoles', () => {
  test('issues DELETE then a single bulk INSERT for the id list', async () => {
    exec.enqueue({ rows: [], rowCount: 3 });
    exec.enqueue({ rows: [], rowCount: 2 });
    await usersRepo.replaceUserRoles('user-1', ['manager', 'user'], testDb);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('DELETE FROM user_roles');
    expect(exec.calls[1].sql).toContain('INSERT INTO user_roles');
    expect(exec.calls[1].sql).toContain('ON CONFLICT DO NOTHING');
    expect(exec.calls[1].params).toEqual(['user-1', 'manager', 'user-1', 'user']);
  });

  test('only issues the DELETE when the id list is empty', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    await usersRepo.replaceUserRoles('user-1', [], testDb);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].sql).toContain('DELETE FROM user_roles');
  });
});

describe('getUserRoleIds', () => {
  test('returns the role ids in the order returned by the query', async () => {
    exec.enqueue({ rows: [{ roleId: 'manager' }, { roleId: 'user' }] });
    const result = await usersRepo.getUserRoleIds('user-1', testDb);
    expect(result).toEqual(['manager', 'user']);
    expect(exec.calls[0].params).toContain('user-1');
  });

  test('returns an empty array when no roles are assigned', async () => {
    exec.enqueue({ rows: [] });
    expect(await usersRepo.getUserRoleIds('user-1', testDb)).toEqual([]);
  });
});

describe('canManageUser', () => {
  test.each([
    [[{ '?column?': 1 }], true],
    [[], false],
  ] as const)('returns %s when query returns %j rows', async (rows, expected) => {
    exec.enqueue({ rows: [...rows] });
    expect(await usersRepo.canManageUser('target-1', 'manager-1', testDb)).toBe(expected);
    expect(exec.calls[0].params).toContain('target-1');
    expect(exec.calls[0].params).toContain('manager-1');
  });
});

describe('getAssignments', () => {
  test('returns clientIds, projectIds, taskIds from the three parallel queries', async () => {
    exec.enqueue({ rows: [{ clientId: 'c1' }, { clientId: 'c2' }] });
    exec.enqueue({ rows: [{ projectId: 'p1' }] });
    exec.enqueue({ rows: [{ taskId: 't1' }, { taskId: 't2' }] });
    const result = await usersRepo.getAssignments('user-1', testDb);
    expect(result).toEqual({
      clientIds: ['c1', 'c2'],
      projectIds: ['p1'],
      taskIds: ['t1', 't2'],
    });
    expect(exec.calls).toHaveLength(3);
    for (const call of exec.calls) {
      expect(call.params).toContain('user-1');
    }
  });
});

describe('replaceUserClients', () => {
  test('issues DELETE then a single bulk INSERT for the id list', async () => {
    exec.enqueue({ rows: [], rowCount: 5 });
    exec.enqueue({ rows: [], rowCount: 2 });
    await usersRepo.replaceUserClients('user-1', ['c1', 'c2'], 'manual', testDb);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('DELETE FROM');
    expect(exec.calls[0].sql).toContain('user_clients');
    expect(exec.calls[1].sql).toContain('INSERT INTO');
    expect(exec.calls[1].sql).toContain('user_clients');
    expect(exec.calls[1].sql).toContain('ON CONFLICT DO NOTHING');
    expect(exec.calls[1].params).toEqual(['user-1', 'c1', 'manual', 'user-1', 'c2', 'manual']);
  });

  test('only issues the DELETE when the id list is empty', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    await usersRepo.replaceUserClients('user-1', [], 'manual', testDb);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].sql).toContain('DELETE');
  });
});

describe('replaceUserProjects', () => {
  test('issues DELETE then a single bulk INSERT into user_projects', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    await usersRepo.replaceUserProjects('user-1', ['p1', 'p2'], 'manual', testDb);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('user_projects');
    expect(exec.calls[1].sql).toContain('user_projects');
    expect(exec.calls[1].params).toEqual(['user-1', 'p1', 'manual', 'user-1', 'p2', 'manual']);
  });
});

describe('replaceUserTasks', () => {
  test('issues DELETE then a single bulk INSERT into user_tasks', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    await usersRepo.replaceUserTasks('user-1', ['t1'], 'manual', testDb);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('user_tasks');
    expect(exec.calls[1].sql).toContain('user_tasks');
    expect(exec.calls[1].params).toEqual(['user-1', 't1', 'manual']);
  });
});
