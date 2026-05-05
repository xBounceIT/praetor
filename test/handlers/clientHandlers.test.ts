import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const apiMocks = {
  clientsCreate: mock(
    (data: unknown): Promise<unknown> => Promise.resolve({ id: 'c-new', ...(data as object) }),
  ),
  clientsUpdate: mock(
    (id: string, updates: unknown): Promise<unknown> =>
      Promise.resolve({ id, ...(updates as object) }),
  ),
  clientsDelete: mock((_id: string): Promise<void> => Promise.resolve()),
  clientsList: mock((): Promise<unknown[]> => Promise.resolve([])),
  clientsCreateProfileOption: mock(
    (..._args: unknown[]): Promise<unknown> => Promise.resolve({ id: 'po-new', value: 'x' }),
  ),
  clientsUpdateProfileOption: mock(
    (..._args: unknown[]): Promise<unknown> => Promise.resolve({ id: 'po-1', value: 'updated' }),
  ),
  clientsDeleteProfileOption: mock((..._args: unknown[]): Promise<void> => Promise.resolve()),
};

mock.module('../../services/api', () => ({
  default: {
    clients: {
      create: (data: unknown) => apiMocks.clientsCreate(data),
      update: (id: string, updates: unknown) => apiMocks.clientsUpdate(id, updates),
      delete: (id: string) => apiMocks.clientsDelete(id),
      list: () => apiMocks.clientsList(),
      createProfileOption: (...args: unknown[]) => apiMocks.clientsCreateProfileOption(...args),
      updateProfileOption: (...args: unknown[]) => apiMocks.clientsUpdateProfileOption(...args),
      deleteProfileOption: (...args: unknown[]) => apiMocks.clientsDeleteProfileOption(...args),
    },
  },
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

const { makeClientHandlers } = await import('../../hooks/handlers/clientHandlers');

type ClientLike = { id: string; name?: string };
type ProjectLike = { id: string; clientId: string };
type TaskLike = { id: string; projectId: string };

const makeStubSetter = <T>(initial: T[]) => {
  let value = initial;
  const setter = mock((updater: T[] | ((prev: T[]) => T[])) => {
    value = typeof updater === 'function' ? (updater as (prev: T[]) => T[])(value) : updater;
  });
  return {
    setter: setter as never,
    get: () => value,
  };
};

describe('makeClientHandlers', () => {
  beforeEach(() => {
    apiMocks.clientsCreate.mockClear();
    apiMocks.clientsUpdate.mockClear();
    apiMocks.clientsDelete.mockClear();
    apiMocks.clientsList.mockClear();
    apiMocks.clientsCreateProfileOption.mockClear();
    apiMocks.clientsUpdateProfileOption.mockClear();
    apiMocks.clientsDeleteProfileOption.mockClear();
  });

  afterEach(() => {
    apiMocks.clientsList.mockReset();
    apiMocks.clientsCreate.mockReset();
    apiMocks.clientsUpdate.mockReset();
    apiMocks.clientsDelete.mockReset();
  });

  test('add appends created client to list', async () => {
    apiMocks.clientsCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'c-new', ...(data as object) }),
    );
    const clients = makeStubSetter<ClientLike>([{ id: 'c1' }]);
    const handlers = makeClientHandlers({
      projects: [],
      setClients: clients.setter,
      setProjects: makeStubSetter<ProjectLike>([]).setter,
      setProjectTasks: makeStubSetter<TaskLike>([]).setter,
    });

    await handlers.add({ name: 'New' });
    expect(apiMocks.clientsCreate).toHaveBeenCalledWith({ name: 'New' });
    expect(clients.get()).toHaveLength(2);
    expect(clients.get()[1]).toEqual({ id: 'c-new', name: 'New' });
  });

  test('add rethrows on api error', async () => {
    apiMocks.clientsCreate.mockImplementation(() => Promise.reject(new Error('boom')));
    const handlers = makeClientHandlers({
      projects: [],
      setClients: makeStubSetter<ClientLike>([]).setter,
      setProjects: makeStubSetter<ProjectLike>([]).setter,
      setProjectTasks: makeStubSetter<TaskLike>([]).setter,
    });
    await expect(handlers.add({ name: 'X' })).rejects.toThrow('boom');
  });

  test('update replaces matching client', async () => {
    apiMocks.clientsUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, ...(updates as object) }),
    );
    const clients = makeStubSetter<ClientLike>([
      { id: 'c1', name: 'Alpha' },
      { id: 'c2', name: 'Beta' },
    ]);
    const handlers = makeClientHandlers({
      projects: [],
      setClients: clients.setter,
      setProjects: makeStubSetter<ProjectLike>([]).setter,
      setProjectTasks: makeStubSetter<TaskLike>([]).setter,
    });

    await handlers.update('c1', { name: 'Alpha-renamed' });
    expect(clients.get()[0]).toEqual({ id: 'c1', name: 'Alpha-renamed' });
    expect(clients.get()[1]).toEqual({ id: 'c2', name: 'Beta' });
  });

  test('delete cascades to projects and projectTasks', async () => {
    apiMocks.clientsDelete.mockImplementation(() => Promise.resolve());
    const clients = makeStubSetter<ClientLike>([{ id: 'c1' }, { id: 'c2' }]);
    const projects = makeStubSetter<ProjectLike>([
      { id: 'p1', clientId: 'c1' },
      { id: 'p2', clientId: 'c1' },
      { id: 'p3', clientId: 'c2' },
    ]);
    const tasks = makeStubSetter<TaskLike>([
      { id: 't1', projectId: 'p1' },
      { id: 't2', projectId: 'p3' },
      { id: 't3', projectId: 'p2' },
    ]);

    const handlers = makeClientHandlers({
      projects: projects.get() as never,
      setClients: clients.setter,
      setProjects: projects.setter,
      setProjectTasks: tasks.setter,
    });

    await handlers.delete('c1');

    expect(apiMocks.clientsDelete).toHaveBeenCalledWith('c1');
    expect(clients.get()).toEqual([{ id: 'c2' }]);
    expect(projects.get()).toEqual([{ id: 'p3', clientId: 'c2' }]);
    expect(tasks.get()).toEqual([{ id: 't2', projectId: 'p3' }]);
  });

  test('updateProfileOption refetches and replaces clients', async () => {
    apiMocks.clientsUpdateProfileOption.mockImplementation(() =>
      Promise.resolve({ id: 'po-1', value: 'updated' }),
    );
    apiMocks.clientsList.mockImplementation(() =>
      Promise.resolve([{ id: 'c-fresh', name: 'fresh' }]),
    );
    const clients = makeStubSetter<ClientLike>([{ id: 'c-old' }]);
    const handlers = makeClientHandlers({
      projects: [],
      setClients: clients.setter,
      setProjects: makeStubSetter<ProjectLike>([]).setter,
      setProjectTasks: makeStubSetter<TaskLike>([]).setter,
    });

    const result = await handlers.updateProfileOption('industry' as never, 'po-1', {
      value: 'new value',
    });

    expect(result).toEqual({ id: 'po-1', value: 'updated' } as never);
    expect(apiMocks.clientsList).toHaveBeenCalled();
    expect(clients.get()).toEqual([{ id: 'c-fresh', name: 'fresh' }]);
  });

  test('createProfileOption rethrows on api error', async () => {
    apiMocks.clientsCreateProfileOption.mockImplementation(() => Promise.reject(new Error('nope')));
    const handlers = makeClientHandlers({
      projects: [],
      setClients: makeStubSetter<ClientLike>([]).setter,
      setProjects: makeStubSetter<ProjectLike>([]).setter,
      setProjectTasks: makeStubSetter<TaskLike>([]).setter,
    });
    await expect(handlers.createProfileOption('industry' as never, 'value')).rejects.toThrow(
      'nope',
    );
  });

  test('deleteProfileOption awaits api call', async () => {
    apiMocks.clientsDeleteProfileOption.mockImplementation(() => Promise.resolve());
    const handlers = makeClientHandlers({
      projects: [],
      setClients: makeStubSetter<ClientLike>([]).setter,
      setProjects: makeStubSetter<ProjectLike>([]).setter,
      setProjectTasks: makeStubSetter<TaskLike>([]).setter,
    });

    await handlers.deleteProfileOption('industry' as never, 'po-2');
    expect(apiMocks.clientsDeleteProfileOption).toHaveBeenCalledWith('industry', 'po-2');
  });
});
