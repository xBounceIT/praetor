import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const apiMocks = {
  usersCreate: mock(
    (..._args: unknown[]): Promise<unknown> =>
      Promise.resolve({ id: 'u-new', name: 'new', username: 'new' }),
  ),
  usersUpdate: mock(
    (id: string, updates: unknown): Promise<unknown> =>
      Promise.resolve({ id, ...(updates as object) }),
  ),
  usersDelete: mock((_id: string): Promise<void> => Promise.resolve()),
  usersUpdateRoles: mock(
    (_id: string, _roleIds: string[], _primaryRoleId: string): Promise<unknown> =>
      Promise.resolve({ primaryRoleId: 'admin' }),
  ),
};

mock.module('../../services/api', () => ({
  default: {
    users: {
      create: (...args: unknown[]) => apiMocks.usersCreate(...args),
      update: (id: string, updates: unknown) => apiMocks.usersUpdate(id, updates),
      delete: (id: string) => apiMocks.usersDelete(id),
      updateRoles: (id: string, roleIds: string[], primaryRoleId: string) =>
        apiMocks.usersUpdateRoles(id, roleIds, primaryRoleId),
    },
    employees: {
      create: mock(() => Promise.resolve({})),
      update: mock(() => Promise.resolve({})),
      delete: mock(() => Promise.resolve()),
    },
    roles: {
      create: mock(() => Promise.resolve({})),
      rename: mock(() => Promise.resolve({})),
      updatePermissions: mock(() => Promise.resolve({})),
      delete: mock(() => Promise.resolve()),
    },
    workUnits: {
      list: mock(() => Promise.resolve([])),
      create: mock(() => Promise.resolve({})),
      update: mock(() => Promise.resolve({})),
      delete: mock(() => Promise.resolve()),
    },
  },
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

const { makeUserHandlers } = await import('../../hooks/handlers/userHandlers');

type UserLike = { id: string; name?: string };

const makeStubSetter = <T>(initial: T[]) => {
  let value = initial;
  const setter = (updater: T[] | ((prev: T[]) => T[])) => {
    value = typeof updater === 'function' ? (updater as (prev: T[]) => T[])(value) : updater;
  };
  return {
    setter: setter as never,
    get: () => value,
  };
};

const makeViewingUserSetter = (initial: string) => {
  let value = initial;
  const setter = (updater: string | ((prev: string) => string)) => {
    value = typeof updater === 'function' ? updater(value) : updater;
  };
  return {
    setter: setter as never,
    get: () => value,
  };
};

describe('makeUserHandlers.deleteUser', () => {
  beforeEach(() => {
    for (const m of Object.values(apiMocks)) {
      m.mockClear();
    }
  });

  afterEach(() => {
    for (const m of Object.values(apiMocks)) {
      m.mockReset();
    }
  });

  test('deleteUser success: removes user and resets viewingUserId when it was the deleted user', async () => {
    apiMocks.usersDelete.mockImplementation(() => Promise.resolve());
    const users = makeStubSetter<UserLike>([{ id: 'u1' }, { id: 'u2' }]);
    const viewing = makeViewingUserSetter('u2');
    const handlers = makeUserHandlers({
      currentUser: { id: 'u-current' } as never,
      viewingUserId: 'u2',
      setUsers: users.setter,
      setRoles: makeStubSetter([]).setter,
      setWorkUnits: makeStubSetter([]).setter,
      setViewingUserId: viewing.setter,
    });

    await handlers.deleteUser('u2');

    expect(apiMocks.usersDelete).toHaveBeenCalledWith('u2');
    expect(users.get()).toEqual([{ id: 'u1' }]);
    expect(viewing.get()).toBe('u-current');
  });

  test('deleteUser API failure: viewingUserId is unchanged and error is surfaced', async () => {
    apiMocks.usersDelete.mockImplementation(() => Promise.reject(new Error('cannot delete')));
    const users = makeStubSetter<UserLike>([{ id: 'u1' }, { id: 'u2' }]);
    const viewing = makeViewingUserSetter('u2');
    const handlers = makeUserHandlers({
      currentUser: { id: 'u-current' } as never,
      viewingUserId: 'u2',
      setUsers: users.setter,
      setRoles: makeStubSetter([]).setter,
      setWorkUnits: makeStubSetter([]).setter,
      setViewingUserId: viewing.setter,
    });

    const originalError = console.error;
    const originalAlert = globalThis.alert;
    console.error = mock(() => {}) as unknown as typeof console.error;
    const alertMock = mock((_msg?: string) => {});
    globalThis.alert = alertMock as unknown as typeof globalThis.alert;
    try {
      await handlers.deleteUser('u2');

      // viewingUserId must remain on the user we tried to delete
      expect(viewing.get()).toBe('u2');
      // users list must remain unchanged
      expect(users.get()).toEqual([{ id: 'u1' }, { id: 'u2' }]);
      // error must be surfaced to the user
      expect(alertMock).toHaveBeenCalledTimes(1);
      expect((alertMock.mock.calls[0]?.[0] as string) ?? '').toContain('cannot delete');
    } finally {
      console.error = originalError;
      globalThis.alert = originalAlert;
    }
  });

  test('deleteUser when viewingUserId is a different user leaves it unchanged on success', async () => {
    apiMocks.usersDelete.mockImplementation(() => Promise.resolve());
    const users = makeStubSetter<UserLike>([{ id: 'u1' }, { id: 'u2' }]);
    const viewing = makeViewingUserSetter('u1');
    const handlers = makeUserHandlers({
      currentUser: { id: 'u-current' } as never,
      viewingUserId: 'u1',
      setUsers: users.setter,
      setRoles: makeStubSetter([]).setter,
      setWorkUnits: makeStubSetter([]).setter,
      setViewingUserId: viewing.setter,
    });

    await handlers.deleteUser('u2');

    expect(users.get()).toEqual([{ id: 'u1' }]);
    expect(viewing.get()).toBe('u1');
  });
});
