import { beforeEach, describe, expect, test } from 'bun:test';
import * as usersRepo from '../../repositories/usersRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

describe('getPasswordHash', () => {
  test('returns the hash when the row exists', async () => {
    exec.enqueue({ rows: [{ passwordHash: '$2b$10$abc' }] });
    const result = await usersRepo.getPasswordHash('user-1', exec);
    expect(result).toBe('$2b$10$abc');
    expect(exec.calls[0].params).toEqual(['user-1']);
  });

  test('returns null when no row exists', async () => {
    exec.enqueue({ rows: [] });
    const result = await usersRepo.getPasswordHash('user-1', exec);
    expect(result).toBeNull();
  });

  test('returns null when the row exists but passwordHash is null', async () => {
    exec.enqueue({ rows: [{ passwordHash: null }] });
    const result = await usersRepo.getPasswordHash('user-1', exec);
    expect(result).toBeNull();
  });
});

describe('findAuthUserById', () => {
  test('returns the mapped user when the row exists', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'user-1',
          name: 'Alice',
          username: 'alice',
          role: 'manager',
          avatarInitials: 'AL',
          isDisabled: false,
        },
      ],
    });
    const result = await usersRepo.findAuthUserById('user-1', exec);
    expect(result).toEqual({
      id: 'user-1',
      name: 'Alice',
      username: 'alice',
      role: 'manager',
      avatarInitials: 'AL',
      isDisabled: false,
    });
    expect(exec.calls[0].params).toEqual(['user-1']);
  });

  test('returns null when no row exists', async () => {
    exec.enqueue({ rows: [] });
    const result = await usersRepo.findAuthUserById('user-1', exec);
    expect(result).toBeNull();
  });
});

describe('findLoginUserByUsername', () => {
  test('returns the mapped login user when the row exists', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'user-1',
          name: 'Alice',
          username: 'alice',
          role: 'manager',
          passwordHash: '$2b$10$abc',
          avatarInitials: 'AL',
          isDisabled: false,
        },
      ],
    });
    const result = await usersRepo.findLoginUserByUsername('alice', exec);
    expect(result).toEqual({
      id: 'user-1',
      name: 'Alice',
      username: 'alice',
      role: 'manager',
      passwordHash: '$2b$10$abc',
      avatarInitials: 'AL',
      isDisabled: false,
    });
    expect(exec.calls[0].params).toEqual(['alice']);
  });

  test('returns null when no row exists', async () => {
    exec.enqueue({ rows: [] });
    const result = await usersRepo.findLoginUserByUsername('alice', exec);
    expect(result).toBeNull();
  });
});

describe('updatePasswordHash', () => {
  test('passes [hash, userId] in that order', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    await usersRepo.updatePasswordHash('user-1', 'new-hash', exec);
    expect(exec.calls[0].params).toEqual(['new-hash', 'user-1']);
  });

  test('resolves to undefined', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    const result = await usersRepo.updatePasswordHash('user-1', 'new-hash', exec);
    expect(result).toBeUndefined();
  });
});

describe('findCostPerHour', () => {
  test('parses string-encoded numerics from pg', async () => {
    exec.enqueue({ rows: [{ costPerHour: '42.5' }] });
    expect(await usersRepo.findCostPerHour('user-1', exec)).toBe(42.5);
  });

  test('passes numeric values through unchanged', async () => {
    exec.enqueue({ rows: [{ costPerHour: 42.5 }] });
    expect(await usersRepo.findCostPerHour('user-1', exec)).toBe(42.5);
  });

  test('returns 0 when row missing', async () => {
    exec.enqueue({ rows: [] });
    expect(await usersRepo.findCostPerHour('user-1', exec)).toBe(0);
  });

  test('returns 0 when costPerHour is null', async () => {
    exec.enqueue({ rows: [{ costPerHour: null }] });
    expect(await usersRepo.findCostPerHour('user-1', exec)).toBe(0);
  });

  test('returns 0 when string is unparseable', async () => {
    exec.enqueue({ rows: [{ costPerHour: 'oops' }] });
    expect(await usersRepo.findCostPerHour('user-1', exec)).toBe(0);
  });
});

describe('updateNameByUsername', () => {
  test('passes [username, name] in that order', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    await usersRepo.updateNameByUsername('alice', 'Alice Smith', exec);
    expect(exec.calls[0].params).toEqual(['alice', 'Alice Smith']);
  });
});

describe('createUser', () => {
  test('passes params in [id, name, username, passwordHash, role, avatarInitials] order', async () => {
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
      exec,
    );
    expect(exec.calls[0].params).toEqual([
      'user-1',
      'Alice Smith',
      'alice',
      '$2a$10$placeholder',
      'user',
      'AS',
    ]);
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
  test('takes no params and maps rows', async () => {
    exec.enqueue({ rows: [sampleListRow] });
    const result = await usersRepo.listAllForAdmin(exec);
    expect(exec.calls[0].params).toEqual([]);
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
    const [user] = await usersRepo.listAllForAdmin(exec);
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
      exec,
    );
    const sql = exec.calls[0].sql;
    expect(sql).toContain('u.id = $1');
    expect(sql).toContain('wum.user_id = $1');
    expect(sql).toContain("u.employee_type = 'internal'");
    expect(sql).not.toContain("u.employee_type = 'external'");
    expect(exec.calls[0].params).toEqual(['viewer-1']);
  });

  test('hides top managers from results via NOT EXISTS', async () => {
    exec.enqueue({ rows: [] });
    await usersRepo.listScopedForManager(
      'viewer-1',
      { canViewManagedUsers: false, canViewInternal: false, canViewExternal: false },
      exec,
    );
    expect(exec.calls[0].sql).toContain('NOT EXISTS');
    expect(exec.calls[0].sql).toContain("role_id = 'top_manager'");
  });
});

describe('findById', () => {
  test('passes id as $1', async () => {
    exec.enqueue({ rows: [sampleListRow] });
    const result = await usersRepo.findById('user-1', exec);
    expect(exec.calls[0].params).toEqual(['user-1']);
    expect(result?.id).toBe('user-1');
  });

  test('returns null when no row exists', async () => {
    exec.enqueue({ rows: [] });
    expect(await usersRepo.findById('user-1', exec)).toBeNull();
  });
});

describe('findCoreById', () => {
  test('returns the mapped core user when the row exists', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'user-1',
          name: 'Alice',
          username: 'alice',
          role: 'manager',
          employeeType: 'internal',
        },
      ],
    });
    const result = await usersRepo.findCoreById('user-1', exec);
    expect(result).toEqual({
      id: 'user-1',
      name: 'Alice',
      username: 'alice',
      role: 'manager',
      employeeType: 'internal',
    });
    expect(exec.calls[0].params).toEqual(['user-1']);
  });

  test('defaults employeeType to app_user when null', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'user-1',
          name: 'Alice',
          username: 'alice',
          role: 'manager',
          employeeType: null,
        },
      ],
    });
    const result = await usersRepo.findCoreById('user-1', exec);
    expect(result?.employeeType).toBe('app_user');
  });

  test('returns null when no row exists', async () => {
    exec.enqueue({ rows: [] });
    expect(await usersRepo.findCoreById('user-1', exec)).toBeNull();
  });
});

describe('existsByUsername', () => {
  test.each([
    [[{ id: 'u1' }], true],
    [[], false],
  ] as const)('returns %s when query returns %j rows', async (rows, expected) => {
    exec.enqueue({ rows: [...rows] });
    expect(await usersRepo.existsByUsername('alice', exec)).toBe(expected);
    expect(exec.calls[0].params).toEqual(['alice']);
  });
});

describe('insertUser', () => {
  test('passes all 9 columns in declared order', async () => {
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
      exec,
    );
    expect(exec.calls[0].params).toEqual([
      'user-1',
      'Alice',
      'alice',
      '$2b$10$x',
      'user',
      'AL',
      42,
      false,
      'internal',
    ]);
  });
});

describe('deleteById', () => {
  test.each([
    [1, true],
    [0, false],
    [null, false],
  ] as const)('returns %s when rowCount is %s', async (rowCount, expected) => {
    exec.enqueue({ rows: [], rowCount });
    expect(await usersRepo.deleteById('user-1', exec)).toBe(expected);
  });

  test('passes the id and uses RETURNING', async () => {
    exec.enqueue({ rows: [{ id: 'user-1' }], rowCount: 1 });
    await usersRepo.deleteById('user-1', exec);
    expect(exec.calls[0].params).toEqual(['user-1']);
    expect(exec.calls[0].sql).toContain('RETURNING id');
  });
});

describe('updateUserDynamic', () => {
  test('returns null without issuing a query when no fields are provided', async () => {
    const result = await usersRepo.updateUserDynamic('user-1', {}, exec);
    expect(result).toBeNull();
    expect(exec.calls.length).toBe(0);
  });

  test('builds a SET clause containing only the provided fields', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'user-1',
          name: 'Alice',
          username: 'alice',
          role: 'user',
          avatarInitials: 'AL',
          costPerHour: 50,
          isDisabled: true,
          employeeType: 'app_user',
        },
      ],
      rowCount: 1,
    });
    await usersRepo.updateUserDynamic(
      'user-1',
      { name: 'Alice', isDisabled: true, costPerHour: 50, role: 'user' },
      exec,
    );
    const sql = exec.calls[0].sql;
    expect(sql).toContain('name = $1');
    expect(sql).toContain('is_disabled = $2');
    expect(sql).toContain('cost_per_hour = $3');
    expect(sql).toContain('role = $4');
    expect(sql).toContain('WHERE id = $5');
    expect(exec.calls[0].params).toEqual(['Alice', true, 50, 'user', 'user-1']);
  });

  test('returns null when no row was updated', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    const result = await usersRepo.updateUserDynamic('user-1', { name: 'Alice' }, exec);
    expect(result).toBeNull();
  });

  test('parses cost_per_hour from string into number on the returned row', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'user-1',
          name: 'Alice',
          username: 'alice',
          role: 'user',
          avatarInitials: 'AL',
          costPerHour: '17.25',
          isDisabled: false,
          employeeType: 'app_user',
        },
      ],
      rowCount: 1,
    });
    const result = await usersRepo.updateUserDynamic('user-1', { name: 'Alice' }, exec);
    expect(result?.costPerHour).toBe(17.25);
  });
});

describe('addUserRole / clearUserRoles / setPrimaryRole', () => {
  test('addUserRole inserts ON CONFLICT DO NOTHING', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    await usersRepo.addUserRole('user-1', 'manager', exec);
    expect(exec.calls[0].sql).toContain('ON CONFLICT DO NOTHING');
    expect(exec.calls[0].params).toEqual(['user-1', 'manager']);
  });

  test('clearUserRoles deletes all rows for the user', async () => {
    exec.enqueue({ rows: [], rowCount: 3 });
    await usersRepo.clearUserRoles('user-1', exec);
    expect(exec.calls[0].sql).toContain('DELETE FROM user_roles');
    expect(exec.calls[0].params).toEqual(['user-1']);
  });

  test('setPrimaryRole passes [roleId, userId] in that order', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    await usersRepo.setPrimaryRole('user-1', 'manager', exec);
    expect(exec.calls[0].params).toEqual(['manager', 'user-1']);
  });
});

describe('getUserRoleIds', () => {
  test('returns the role ids in the order returned by the query', async () => {
    exec.enqueue({ rows: [{ roleId: 'manager' }, { roleId: 'user' }] });
    const result = await usersRepo.getUserRoleIds('user-1', exec);
    expect(result).toEqual(['manager', 'user']);
    expect(exec.calls[0].params).toEqual(['user-1']);
  });

  test('returns an empty array when no roles are assigned', async () => {
    exec.enqueue({ rows: [] });
    expect(await usersRepo.getUserRoleIds('user-1', exec)).toEqual([]);
  });
});

describe('canManageUser', () => {
  test.each([
    [[{ '?column?': 1 }], true],
    [[], false],
  ] as const)('returns %s when query returns %j rows', async (rows, expected) => {
    exec.enqueue({ rows: [...rows] });
    expect(await usersRepo.canManageUser('target-1', 'manager-1', exec)).toBe(expected);
    expect(exec.calls[0].params).toEqual(['target-1', 'manager-1']);
  });
});

describe('getAssignments', () => {
  test('returns clientIds, projectIds, taskIds from the three parallel queries', async () => {
    exec.enqueue({ rows: [{ clientId: 'c1' }, { clientId: 'c2' }] });
    exec.enqueue({ rows: [{ projectId: 'p1' }] });
    exec.enqueue({ rows: [{ taskId: 't1' }, { taskId: 't2' }] });
    const result = await usersRepo.getAssignments('user-1', exec);
    expect(result).toEqual({
      clientIds: ['c1', 'c2'],
      projectIds: ['p1'],
      taskIds: ['t1', 't2'],
    });
    expect(exec.calls).toHaveLength(3);
    for (const call of exec.calls) {
      expect(call.params).toEqual(['user-1']);
    }
  });
});

describe('replaceUserClients', () => {
  test('issues DELETE then a single bulk INSERT for the id list', async () => {
    exec.enqueue({ rows: [], rowCount: 5 }); // DELETE
    exec.enqueue({ rows: [], rowCount: 2 }); // INSERT
    await usersRepo.replaceUserClients('user-1', ['c1', 'c2'], 'manual', exec);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('DELETE FROM user_clients');
    expect(exec.calls[0].params).toEqual(['user-1']);
    expect(exec.calls[1].sql).toContain('INSERT INTO user_clients');
    expect(exec.calls[1].sql).toContain('ON CONFLICT DO NOTHING');
    expect(exec.calls[1].params).toEqual(['user-1', 'c1', 'manual', 'user-1', 'c2', 'manual']);
  });

  test('only issues the DELETE when the id list is empty', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    await usersRepo.replaceUserClients('user-1', [], 'manual', exec);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].sql).toContain('DELETE');
  });
});

describe('replaceUserProjects', () => {
  test('issues DELETE then a single bulk INSERT into user_projects', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    await usersRepo.replaceUserProjects('user-1', ['p1', 'p2'], 'manual', exec);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('DELETE FROM user_projects');
    expect(exec.calls[1].sql).toContain('INSERT INTO user_projects');
    expect(exec.calls[1].params).toEqual(['user-1', 'p1', 'manual', 'user-1', 'p2', 'manual']);
  });
});

describe('replaceUserTasks', () => {
  test('issues DELETE then a single bulk INSERT into user_tasks', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    await usersRepo.replaceUserTasks('user-1', ['t1'], 'manual', exec);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('DELETE FROM user_tasks');
    expect(exec.calls[1].sql).toContain('INSERT INTO user_tasks');
    expect(exec.calls[1].params).toEqual(['user-1', 't1', 'manual']);
  });
});

describe('clearProjectCascadeAssignments', () => {
  test('only deletes rows whose assignment_source is project_cascade', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    await usersRepo.clearProjectCascadeAssignments('user-1', exec);
    expect(exec.calls[0].sql).toContain("assignment_source = 'project_cascade'");
    expect(exec.calls[0].params).toEqual(['user-1']);
  });
});

describe('applyProjectCascadeToClients', () => {
  test('inserts derived rows from user_projects join projects with project_cascade source', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    await usersRepo.applyProjectCascadeToClients('user-1', exec);
    expect(exec.calls[0].sql).toContain("'project_cascade'");
    expect(exec.calls[0].sql).toContain('JOIN projects');
    expect(exec.calls[0].sql).toContain('ON CONFLICT (user_id, client_id) DO NOTHING');
    expect(exec.calls[0].params).toEqual(['user-1']);
  });
});
