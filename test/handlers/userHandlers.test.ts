import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const apiMocks = {
  usersCreate: mock(
    (
      name: string,
      _username: string,
      _password: string,
      role: string,
      email?: string,
    ): Promise<unknown> => Promise.resolve({ id: 'u-new', name, role, email }),
  ),
  usersUpdate: mock(
    (id: string, updates: unknown): Promise<unknown> =>
      Promise.resolve({ id, ...(updates as object) }),
  ),
  usersUpdateRoles: mock(
    (_id: string, _roleIds: string[], primaryRoleId: string): Promise<unknown> =>
      Promise.resolve({ primaryRoleId }),
  ),
  usersDelete: mock((_id: string): Promise<void> => Promise.resolve()),
  employeesCreate: mock(
    (data: unknown): Promise<unknown> => Promise.resolve({ id: 'e-new', ...(data as object) }),
  ),
  employeesUpdate: mock(
    (id: string, updates: unknown): Promise<unknown> =>
      Promise.resolve({ id, ...(updates as object) }),
  ),
  employeesDelete: mock((_id: string): Promise<void> => Promise.resolve()),
  rolesCreate: mock(
    (name: string, permissions: string[]): Promise<unknown> =>
      Promise.resolve({ id: 'r-new', name, permissions }),
  ),
  rolesRename: mock((id: string, name: string): Promise<unknown> => Promise.resolve({ id, name })),
  rolesUpdatePermissions: mock(
    (id: string, permissions: string[]): Promise<unknown> => Promise.resolve({ id, permissions }),
  ),
  rolesDelete: mock((_id: string): Promise<void> => Promise.resolve()),
  workUnitsCreate: mock(
    (data: unknown): Promise<unknown> => Promise.resolve({ id: 'wu-new', ...(data as object) }),
  ),
  workUnitsUpdate: mock(
    (id: string, updates: unknown): Promise<unknown> =>
      Promise.resolve({ id, ...(updates as object) }),
  ),
  workUnitsDelete: mock((_id: string): Promise<void> => Promise.resolve()),
  workUnitsList: mock((): Promise<unknown[]> => Promise.resolve([])),
};

mock.module('../../services/api', () => ({
  default: {
    users: {
      create: (name: string, username: string, password: string, role: string, email?: string) =>
        apiMocks.usersCreate(name, username, password, role, email),
      update: (id: string, updates: unknown) => apiMocks.usersUpdate(id, updates),
      updateRoles: (id: string, roleIds: string[], primaryRoleId: string) =>
        apiMocks.usersUpdateRoles(id, roleIds, primaryRoleId),
      delete: (id: string) => apiMocks.usersDelete(id),
    },
    employees: {
      create: (data: unknown) => apiMocks.employeesCreate(data),
      update: (id: string, updates: unknown) => apiMocks.employeesUpdate(id, updates),
      delete: (id: string) => apiMocks.employeesDelete(id),
    },
    roles: {
      create: (name: string, permissions: string[]) => apiMocks.rolesCreate(name, permissions),
      rename: (id: string, name: string) => apiMocks.rolesRename(id, name),
      updatePermissions: (id: string, permissions: string[]) =>
        apiMocks.rolesUpdatePermissions(id, permissions),
      delete: (id: string) => apiMocks.rolesDelete(id),
    },
    workUnits: {
      create: (data: unknown) => apiMocks.workUnitsCreate(data),
      update: (id: string, updates: unknown) => apiMocks.workUnitsUpdate(id, updates),
      delete: (id: string) => apiMocks.workUnitsDelete(id),
      list: () => apiMocks.workUnitsList(),
    },
  },
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

const { makeUserHandlers } = await import('../../hooks/handlers/userHandlers');

type UserLike = {
  id: string;
  name?: string;
  role?: string;
  hasTopManagerRole?: boolean;
  isAdminOnly?: boolean;
  costPerHour?: number;
};
type RoleLike = { id: string; name?: string; permissions?: string[] };
type WorkUnitLike = { id: string; name?: string };

type AnyFn = (...args: unknown[]) => void;
const makeStubSetter = <T>(initial: T[]) => {
  let value = initial;
  const setter = ((updater: T[] | ((prev: T[]) => T[])) => {
    value = typeof updater === 'function' ? (updater as (prev: T[]) => T[])(value) : updater;
  }) as AnyFn;
  return { setter, get: () => value };
};

const makeStubScalar = <T>(initial: T) => {
  let value = initial;
  const setter = ((updater: T | ((prev: T) => T)) => {
    value = typeof updater === 'function' ? (updater as (prev: T) => T)(value) : updater;
  }) as AnyFn;
  return { setter, get: () => value };
};

const buildHandlers = (overrides: Record<string, unknown> = {}) => {
  const users = makeStubSetter<UserLike>((overrides.users as UserLike[] | undefined) ?? []);
  const roles = makeStubSetter<RoleLike>([]);
  const workUnits = makeStubSetter<WorkUnitLike>([]);
  const viewingUserId = makeStubScalar<string>(
    (overrides.viewingUserId as string | undefined) ?? '',
  );
  const handlers = makeUserHandlers({
    currentUser: (overrides.currentUser as never) ?? null,
    viewingUserId: viewingUserId.get(),
    setUsers: users.setter as never,
    setRoles: roles.setter as never,
    setWorkUnits: workUnits.setter as never,
    setViewingUserId: viewingUserId.setter as never,
  });
  return { handlers, users, roles, workUnits, viewingUserId };
};

const silenceConsole = () => {
  const originalError = console.error;
  const originalAlert = globalThis.alert;
  console.error = mock(() => {}) as unknown as typeof console.error;
  globalThis.alert = mock(() => {}) as unknown as typeof globalThis.alert;
  return () => {
    console.error = originalError;
    globalThis.alert = originalAlert;
  };
};

describe('makeUserHandlers — users', () => {
  beforeEach(() => {
    for (const m of Object.values(apiMocks)) m.mockClear();
  });

  afterEach(() => {
    for (const m of Object.values(apiMocks)) m.mockReset();
  });

  test('addUser appends and returns success', async () => {
    apiMocks.usersCreate.mockImplementation((name: string) =>
      Promise.resolve({ id: 'u-new', name }),
    );
    const ctx = buildHandlers();
    const result = await ctx.handlers.addUser('Alice', 'alice', 'pw', 'admin', 'a@x');
    expect(result).toEqual({ success: true });
    expect(apiMocks.usersCreate).toHaveBeenCalledWith('Alice', 'alice', 'pw', 'admin', 'a@x');
    expect(ctx.users.get()).toEqual([{ id: 'u-new', name: 'Alice' }]);
  });

  test('addUser returns failure on api error', async () => {
    apiMocks.usersCreate.mockImplementation(() => Promise.reject(new Error('dup')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      const result = await ctx.handlers.addUser('A', 'a', 'p', 'admin');
      expect(result).toEqual({ success: false, error: 'dup' });
    } finally {
      restore();
    }
  });

  test('updateUser replaces matching user', async () => {
    apiMocks.usersUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, ...(updates as object) }),
    );
    const ctx = buildHandlers({ users: [{ id: 'u1', name: 'Old' }] });
    await ctx.handlers.updateUser('u1', { name: 'New' });
    expect(ctx.users.get()[0]).toEqual({ id: 'u1', name: 'New' });
  });

  test('updateUser alerts and swallows on error', async () => {
    apiMocks.usersUpdate.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers({ users: [{ id: 'u1' }] });
    const restore = silenceConsole();
    try {
      await ctx.handlers.updateUser('u1', { name: 'X' });
      expect(ctx.users.get()).toEqual([{ id: 'u1' }]);
    } finally {
      restore();
    }
  });

  test('updateUserRoles flags top-manager and admin-only correctly', async () => {
    apiMocks.usersUpdateRoles.mockImplementation((_id: string, _ids: string[], primary: string) =>
      Promise.resolve({ primaryRoleId: primary }),
    );
    const ctx = buildHandlers({ users: [{ id: 'u1' }] });

    await ctx.handlers.updateUserRoles('u1', ['top_manager', 'sales'], 'top_manager');
    expect(ctx.users.get()[0]).toEqual({
      id: 'u1',
      role: 'top_manager',
      hasTopManagerRole: true,
      isAdminOnly: false,
    });
  });

  test('updateUserRoles flags isAdminOnly when only admin role given', async () => {
    apiMocks.usersUpdateRoles.mockImplementation((_id: string, _ids: string[], primary: string) =>
      Promise.resolve({ primaryRoleId: primary }),
    );
    const ctx = buildHandlers({ users: [{ id: 'u1' }] });

    await ctx.handlers.updateUserRoles('u1', ['admin'], 'admin');
    expect(ctx.users.get()[0]).toEqual({
      id: 'u1',
      role: 'admin',
      hasTopManagerRole: false,
      isAdminOnly: true,
    });
  });

  test('updateUserRoles alerts and rethrows on error', async () => {
    apiMocks.usersUpdateRoles.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers({ users: [{ id: 'u1' }] });
    const restore = silenceConsole();
    try {
      await expect(ctx.handlers.updateUserRoles('u1', ['x'], 'x')).rejects.toThrow('boom');
    } finally {
      restore();
    }
  });

  test('deleteUser removes from list and resets viewingUserId when matched', async () => {
    apiMocks.usersDelete.mockImplementation(() => Promise.resolve());
    const ctx = buildHandlers({
      users: [{ id: 'u1' }, { id: 'u2' }],
      currentUser: { id: 'u-current' } as never,
      viewingUserId: 'u1',
    });

    await ctx.handlers.deleteUser('u1');
    expect(ctx.users.get()).toEqual([{ id: 'u2' }]);
    expect(ctx.viewingUserId.get()).toBe('u-current');
  });

  test('deleteUser falls back to empty viewingUserId when no current user', async () => {
    apiMocks.usersDelete.mockImplementation(() => Promise.resolve());
    const ctx = buildHandlers({
      users: [{ id: 'u1' }],
      currentUser: null,
      viewingUserId: 'u1',
    });

    await ctx.handlers.deleteUser('u1');
    expect(ctx.viewingUserId.get()).toBe('');
  });

  test('deleteUser leaves viewingUserId untouched when ids differ', async () => {
    apiMocks.usersDelete.mockImplementation(() => Promise.resolve());
    const ctx = buildHandlers({
      users: [{ id: 'u1' }, { id: 'u2' }],
      currentUser: { id: 'u-current' } as never,
      viewingUserId: 'u-other',
    });

    await ctx.handlers.deleteUser('u1');
    expect(ctx.viewingUserId.get()).toBe('u-other');
  });

  test('deleteUser swallows errors', async () => {
    apiMocks.usersDelete.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers({ users: [{ id: 'u1' }] });
    const restore = silenceConsole();
    try {
      await ctx.handlers.deleteUser('u1');
    } finally {
      restore();
    }
  });
});

describe('makeUserHandlers — employees', () => {
  beforeEach(() => {
    for (const m of Object.values(apiMocks)) m.mockClear();
  });

  afterEach(() => {
    for (const m of Object.values(apiMocks)) m.mockReset();
  });

  test('addInternalEmployee delegates to employees.create', async () => {
    apiMocks.employeesCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'e-new', ...(data as object) }),
    );
    const ctx = buildHandlers();
    const result = await ctx.handlers.addInternalEmployee('Bob', 75);
    expect(result).toEqual({ success: true });
    expect(apiMocks.employeesCreate).toHaveBeenCalledWith({
      name: 'Bob',
      employeeType: 'internal',
      costPerHour: 75,
    });
    expect(ctx.users.get()[0].name).toBe('Bob');
  });

  test('addExternalEmployee delegates to employees.create', async () => {
    apiMocks.employeesCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'e-new', ...(data as object) }),
    );
    const ctx = buildHandlers();
    await ctx.handlers.addExternalEmployee('Eve');
    expect(apiMocks.employeesCreate).toHaveBeenCalledWith({
      name: 'Eve',
      employeeType: 'external',
      costPerHour: undefined,
    });
  });

  test('addInternalEmployee returns failure on api error', async () => {
    apiMocks.employeesCreate.mockImplementation(() => Promise.reject(new Error('dup')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      const result = await ctx.handlers.addInternalEmployee('Bob');
      expect(result).toEqual({ success: false, error: 'dup' });
    } finally {
      restore();
    }
  });

  test('addInternalEmployee handles non-Error rejection', async () => {
    apiMocks.employeesCreate.mockImplementation(() => Promise.reject('weird'));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      const result = await ctx.handlers.addInternalEmployee('Bob');
      expect(result).toEqual({ success: false, error: 'Failed to create employee' });
    } finally {
      restore();
    }
  });

  test('updateEmployee replaces matching user', async () => {
    apiMocks.employeesUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, ...(updates as object) }),
    );
    const ctx = buildHandlers({ users: [{ id: 'u1', name: 'Old' }] });
    await ctx.handlers.updateEmployee('u1', { name: 'New' });
    expect(ctx.users.get()[0]).toEqual({ id: 'u1', name: 'New' });
  });

  test('updateEmployee swallows errors', async () => {
    apiMocks.employeesUpdate.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers({ users: [{ id: 'u1' }] });
    const restore = silenceConsole();
    try {
      await ctx.handlers.updateEmployee('u1', { name: 'X' });
    } finally {
      restore();
    }
  });

  test('deleteEmployee removes user', async () => {
    apiMocks.employeesDelete.mockImplementation(() => Promise.resolve());
    const ctx = buildHandlers({ users: [{ id: 'u1' }, { id: 'u2' }] });
    await ctx.handlers.deleteEmployee('u1');
    expect(ctx.users.get()).toEqual([{ id: 'u2' }]);
  });

  test('deleteEmployee swallows errors', async () => {
    apiMocks.employeesDelete.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers({ users: [{ id: 'u1' }] });
    const restore = silenceConsole();
    try {
      await ctx.handlers.deleteEmployee('u1');
    } finally {
      restore();
    }
  });
});

describe('makeUserHandlers — roles', () => {
  beforeEach(() => {
    for (const m of Object.values(apiMocks)) m.mockClear();
  });

  afterEach(() => {
    for (const m of Object.values(apiMocks)) m.mockReset();
  });

  test('createRole appends new role', async () => {
    apiMocks.rolesCreate.mockImplementation((name: string, permissions: string[]) =>
      Promise.resolve({ id: 'r-new', name, permissions }),
    );
    const ctx = buildHandlers();
    await ctx.handlers.createRole('Sales', ['sales.view']);
    expect(ctx.roles.get()).toEqual([{ id: 'r-new', name: 'Sales', permissions: ['sales.view'] }]);
  });

  test('createRole rethrows api error', async () => {
    apiMocks.rolesCreate.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await expect(ctx.handlers.createRole('X', [])).rejects.toThrow('boom');
    } finally {
      restore();
    }
  });

  test('renameRole replaces matching role', async () => {
    apiMocks.rolesRename.mockImplementation((id: string, name: string) =>
      Promise.resolve({ id, name }),
    );
    const ctx = buildHandlers();
    ctx.roles.setter([{ id: 'r1', name: 'Old' }] as never);
    await ctx.handlers.renameRole('r1', 'New');
    expect(ctx.roles.get()).toEqual([{ id: 'r1', name: 'New' }]);
  });

  test('renameRole rethrows api error', async () => {
    apiMocks.rolesRename.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await expect(ctx.handlers.renameRole('r1', 'X')).rejects.toThrow('boom');
    } finally {
      restore();
    }
  });

  test('updateRolePermissions replaces matching role', async () => {
    apiMocks.rolesUpdatePermissions.mockImplementation((id: string, perms: string[]) =>
      Promise.resolve({ id, permissions: perms }),
    );
    const ctx = buildHandlers();
    ctx.roles.setter([{ id: 'r1', permissions: [] }] as never);
    await ctx.handlers.updateRolePermissions('r1', ['a.view']);
    expect(ctx.roles.get()).toEqual([{ id: 'r1', permissions: ['a.view'] }]);
  });

  test('updateRolePermissions rethrows api error', async () => {
    apiMocks.rolesUpdatePermissions.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await expect(ctx.handlers.updateRolePermissions('r1', [])).rejects.toThrow('boom');
    } finally {
      restore();
    }
  });

  test('deleteRole removes from list', async () => {
    apiMocks.rolesDelete.mockImplementation(() => Promise.resolve());
    const ctx = buildHandlers();
    ctx.roles.setter([{ id: 'r1' }, { id: 'r2' }] as never);
    await ctx.handlers.deleteRole('r1');
    expect(ctx.roles.get()).toEqual([{ id: 'r2' }]);
  });

  test('deleteRole rethrows api error', async () => {
    apiMocks.rolesDelete.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await expect(ctx.handlers.deleteRole('r1')).rejects.toThrow('boom');
    } finally {
      restore();
    }
  });
});

describe('makeUserHandlers — work units', () => {
  beforeEach(() => {
    for (const m of Object.values(apiMocks)) m.mockClear();
  });

  afterEach(() => {
    for (const m of Object.values(apiMocks)) m.mockReset();
  });

  test('addWorkUnit appends new unit', async () => {
    apiMocks.workUnitsCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'wu-new', ...(data as object) }),
    );
    const ctx = buildHandlers();
    await ctx.handlers.addWorkUnit({ name: 'WU' });
    expect(ctx.workUnits.get()).toEqual([{ id: 'wu-new', name: 'WU' }]);
  });

  test('addWorkUnit rethrows api error', async () => {
    apiMocks.workUnitsCreate.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await expect(ctx.handlers.addWorkUnit({})).rejects.toThrow('boom');
    } finally {
      restore();
    }
  });

  test('updateWorkUnit replaces matching unit', async () => {
    apiMocks.workUnitsUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, ...(updates as object) }),
    );
    const ctx = buildHandlers();
    ctx.workUnits.setter([{ id: 'wu1', name: 'Old' }] as never);
    await ctx.handlers.updateWorkUnit('wu1', { name: 'New' });
    expect(ctx.workUnits.get()).toEqual([{ id: 'wu1', name: 'New' }]);
  });

  test('updateWorkUnit rethrows api error', async () => {
    apiMocks.workUnitsUpdate.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await expect(ctx.handlers.updateWorkUnit('wu1', {})).rejects.toThrow('boom');
    } finally {
      restore();
    }
  });

  test('deleteWorkUnit removes from list', async () => {
    apiMocks.workUnitsDelete.mockImplementation(() => Promise.resolve());
    const ctx = buildHandlers();
    ctx.workUnits.setter([{ id: 'wu1' }, { id: 'wu2' }] as never);
    await ctx.handlers.deleteWorkUnit('wu1');
    expect(ctx.workUnits.get()).toEqual([{ id: 'wu2' }]);
  });

  test('deleteWorkUnit rethrows api error', async () => {
    apiMocks.workUnitsDelete.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await expect(ctx.handlers.deleteWorkUnit('wu1')).rejects.toThrow('boom');
    } finally {
      restore();
    }
  });

  test('fetchWorkUnits replaces work units list', async () => {
    apiMocks.workUnitsList.mockImplementation(() => Promise.resolve([{ id: 'wu-fresh' }]));
    const ctx = buildHandlers();
    await ctx.handlers.fetchWorkUnits();
    expect(ctx.workUnits.get()).toEqual([{ id: 'wu-fresh' }]);
  });

  test('fetchWorkUnits swallows errors', async () => {
    apiMocks.workUnitsList.mockImplementation(() => Promise.reject(new Error('boom')));
    const ctx = buildHandlers();
    const restore = silenceConsole();
    try {
      await ctx.handlers.fetchWorkUnits();
      expect(ctx.workUnits.get()).toEqual([]);
    } finally {
      restore();
    }
  });
});
