import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const apiMocks = {
  projectsCreate: mock(
    (data: unknown): Promise<unknown> => Promise.resolve({ id: 'proj-new', ...(data as object) }),
  ),
  projectsUpdate: mock(
    (id: string, updates: unknown): Promise<unknown> =>
      Promise.resolve({ id, ...(updates as object) }),
  ),
  projectsDelete: mock((_id: string): Promise<void> => Promise.resolve()),
  tasksCreate: mock(
    (..._args: unknown[]): Promise<unknown> => Promise.resolve({ id: 'task-new', name: 'task' }),
  ),
};

mock.module('../../services/api', () => ({
  default: {
    projects: {
      create: (data: unknown) => apiMocks.projectsCreate(data),
      update: (id: string, updates: unknown) => apiMocks.projectsUpdate(id, updates),
      delete: (id: string) => apiMocks.projectsDelete(id),
    },
    tasks: {
      create: (...args: unknown[]) => apiMocks.tasksCreate(...args),
    },
  },
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

const { makeProjectHandlers } = await import('../../hooks/handlers/projectHandlers');

type ProjectLike = { id: string; clientId: string; color?: string };
type TaskLike = { id: string; projectId: string };
type EntryLike = { id: string; projectId: string };

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

describe('makeProjectHandlers', () => {
  beforeEach(() => {
    Object.values(apiMocks).forEach((m) => m.mockClear());
  });

  afterEach(() => {
    Object.values(apiMocks).forEach((m) => m.mockReset());
  });

  test('add creates project from order', async () => {
    apiMocks.projectsCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'proj-new', ...(data as object) }),
    );
    const projects = makeStubSetter<ProjectLike>([]);
    const handlers = makeProjectHandlers({
      projects: projects.get() as never,
      clientsOrders: [{ id: 'order-1', clientId: 'client-A' } as never],
      setProjects: projects.setter,
      setProjectTasks: makeStubSetter<TaskLike>([]).setter,
      setEntries: makeStubSetter<EntryLike>([]).setter,
    });

    await handlers.add('Project Alpha', 'order-1');
    expect(apiMocks.projectsCreate).toHaveBeenCalled();
    const callArg = apiMocks.projectsCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.name).toBe('Project Alpha');
    expect(callArg.clientId).toBe('client-A');
    expect(callArg.orderId).toBe('order-1');
    expect(projects.get()).toHaveLength(1);
  });

  test('add with draftTasks creates tasks too', async () => {
    apiMocks.projectsCreate.mockImplementation(() =>
      Promise.resolve({ id: 'proj-new', clientId: 'c1' }),
    );
    apiMocks.tasksCreate.mockImplementation(((name: string) =>
      Promise.resolve({ id: `task-${name}`, projectId: 'proj-new', name })) as never);
    const projects = makeStubSetter<ProjectLike>([]);
    const tasks = makeStubSetter<TaskLike>([]);
    const handlers = makeProjectHandlers({
      projects: projects.get() as never,
      clientsOrders: [{ id: 'order-1', clientId: 'c1' } as never],
      setProjects: projects.setter,
      setProjectTasks: tasks.setter,
      setEntries: makeStubSetter<EntryLike>([]).setter,
    });

    await handlers.add('Project', 'order-1', undefined, [
      { name: 'task-A' },
      { name: 'task-B' },
    ] as never);

    expect(apiMocks.tasksCreate).toHaveBeenCalledTimes(2);
    expect(tasks.get()).toHaveLength(2);
  });

  test('add with unknown order silently fails', async () => {
    const projects = makeStubSetter<ProjectLike>([]);
    const handlers = makeProjectHandlers({
      projects: projects.get() as never,
      clientsOrders: [],
      setProjects: projects.setter,
      setProjectTasks: makeStubSetter<TaskLike>([]).setter,
      setEntries: makeStubSetter<EntryLike>([]).setter,
    });

    const originalError = console.error;
    console.error = mock(() => {}) as unknown as typeof console.error;
    try {
      await handlers.add('P', 'unknown-order');
      expect(apiMocks.projectsCreate).not.toHaveBeenCalled();
      expect(projects.get()).toEqual([]);
    } finally {
      console.error = originalError;
    }
  });

  test('addTask creates task and appends', async () => {
    apiMocks.tasksCreate.mockImplementation(() =>
      Promise.resolve({ id: 't-new', projectId: 'p1', name: 'New' }),
    );
    const tasks = makeStubSetter<TaskLike>([{ id: 't1', projectId: 'p1' }]);
    const handlers = makeProjectHandlers({
      projects: [],
      clientsOrders: [],
      setProjects: makeStubSetter<ProjectLike>([]).setter,
      setProjectTasks: tasks.setter,
      setEntries: makeStubSetter<EntryLike>([]).setter,
    });

    await handlers.addTask('New', 'p1');
    expect(tasks.get()).toHaveLength(2);
  });

  test('update replaces matching project', async () => {
    apiMocks.projectsUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, ...(updates as object) }),
    );
    const projects = makeStubSetter<ProjectLike>([
      { id: 'p1', clientId: 'c1', color: 'red' },
      { id: 'p2', clientId: 'c2', color: 'blue' },
    ]);
    const handlers = makeProjectHandlers({
      projects: projects.get() as never,
      clientsOrders: [],
      setProjects: projects.setter,
      setProjectTasks: makeStubSetter<TaskLike>([]).setter,
      setEntries: makeStubSetter<EntryLike>([]).setter,
    });

    await handlers.update('p1', { color: 'green' });
    expect(projects.get()[0].color).toBe('green');
    expect(projects.get()[1].color).toBe('blue');
  });

  test('delete cascades to tasks and entries', async () => {
    apiMocks.projectsDelete.mockImplementation(() => Promise.resolve());
    const projects = makeStubSetter<ProjectLike>([
      { id: 'p1', clientId: 'c1' },
      { id: 'p2', clientId: 'c1' },
    ]);
    const tasks = makeStubSetter<TaskLike>([
      { id: 't1', projectId: 'p1' },
      { id: 't2', projectId: 'p2' },
    ]);
    const entries = makeStubSetter<EntryLike>([
      { id: 'e1', projectId: 'p1' },
      { id: 'e2', projectId: 'p2' },
    ]);

    const handlers = makeProjectHandlers({
      projects: projects.get() as never,
      clientsOrders: [],
      setProjects: projects.setter,
      setProjectTasks: tasks.setter,
      setEntries: entries.setter,
    });

    await handlers.delete('p1');

    expect(projects.get()).toEqual([{ id: 'p2', clientId: 'c1' }]);
    expect(tasks.get()).toEqual([{ id: 't2', projectId: 'p2' }]);
    expect(entries.get()).toEqual([{ id: 'e2', projectId: 'p2' }]);
  });
});
