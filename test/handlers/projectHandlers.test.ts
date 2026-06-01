import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ApiErrorStub } from '../helpers/apiErrorStub';
import { clearSpyStateAfterAll } from '../helpers/mockCleanup.ts';

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

const toastErrorMock = mock((_message: string) => {});

mock.module('../../utils/toast', () => ({
  toastError: (message: string) => toastErrorMock(message),
  toastSuccess: () => {},
  toast: { error: () => {}, success: () => {}, info: () => {} },
}));

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
  ApiError: ApiErrorStub,
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

clearSpyStateAfterAll();

const { makeProjectHandlers } = await import('../../hooks/handlers/projectHandlers');

type ProjectLike = { id: string; clientId: string; name?: string };
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
    Object.values(apiMocks).forEach((m) => {
      m.mockClear();
    });
    toastErrorMock.mockClear();
  });

  afterEach(() => {
    Object.values(apiMocks).forEach((m) => {
      m.mockReset();
    });
  });

  test('add creates project with provided client and order', async () => {
    apiMocks.projectsCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'proj-new', ...(data as object) }),
    );
    const projects = makeStubSetter<ProjectLike>([]);
    const handlers = makeProjectHandlers({
      setProjects: projects.setter,
      setProjectTasks: makeStubSetter<TaskLike>([]).setter,
      setEntries: makeStubSetter<EntryLike>([]).setter,
    });

    await handlers.add({
      name: 'Project Alpha',
      clientId: 'client-A',
      orderId: 'order-1',
      offerId: 'of-1',
    });
    expect(apiMocks.projectsCreate).toHaveBeenCalled();
    const callArg = apiMocks.projectsCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.name).toBe('Project Alpha');
    expect(callArg.clientId).toBe('client-A');
    expect(callArg.orderId).toBe('order-1');
    expect(callArg.offerId).toBe('of-1');
    expect(projects.get()).toHaveLength(1);
  });

  test('add creates project without orderId when none provided', async () => {
    apiMocks.projectsCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'proj-new', ...(data as object) }),
    );
    const projects = makeStubSetter<ProjectLike>([]);
    const handlers = makeProjectHandlers({
      setProjects: projects.setter,
      setProjectTasks: makeStubSetter<TaskLike>([]).setter,
      setEntries: makeStubSetter<EntryLike>([]).setter,
    });

    await handlers.add({ name: 'Project Beta', clientId: 'client-B', offerId: 'of-1' });
    expect(apiMocks.projectsCreate).toHaveBeenCalled();
    const callArg = apiMocks.projectsCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.clientId).toBe('client-B');
    expect(callArg.orderId).toBeUndefined();
    expect(projects.get()).toHaveLength(1);
  });

  test('add forwards new lifecycle fields', async () => {
    apiMocks.projectsCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'proj-new', ...(data as object) }),
    );
    const projects = makeStubSetter<ProjectLike>([]);
    const handlers = makeProjectHandlers({
      setProjects: projects.setter,
      setProjectTasks: makeStubSetter<TaskLike>([]).setter,
      setEntries: makeStubSetter<EntryLike>([]).setter,
    });

    await handlers.add({
      name: 'P',
      clientId: 'client-A',
      orderId: 'order-1',
      offerId: 'of-1',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      revenue: 5000,
    });
    const callArg = apiMocks.projectsCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.startDate).toBe('2026-01-01');
    expect(callArg.endDate).toBe('2026-12-31');
    expect(callArg.revenue).toBe(5000);
    expect(callArg.offerId).toBe('of-1');
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
      setProjects: projects.setter,
      setProjectTasks: tasks.setter,
      setEntries: makeStubSetter<EntryLike>([]).setter,
    });

    await handlers.add({
      name: 'Project',
      clientId: 'c1',
      orderId: 'order-1',
      offerId: 'of-1',
      draftTasks: [{ name: 'task-A' }, { name: 'task-B' }] as never,
    });

    expect(apiMocks.tasksCreate).toHaveBeenCalledTimes(2);
    expect(tasks.get()).toHaveLength(2);
  });

  test('add surfaces error to user via toast when clientId is missing', async () => {
    const projects = makeStubSetter<ProjectLike>([]);
    const handlers = makeProjectHandlers({
      setProjects: projects.setter,
      setProjectTasks: makeStubSetter<TaskLike>([]).setter,
      setEntries: makeStubSetter<EntryLike>([]).setter,
    });

    const originalError = console.error;
    console.error = mock(() => {}) as unknown as typeof console.error;
    try {
      await handlers.add({ name: 'P', clientId: '', offerId: 'of-1' });
      expect(apiMocks.projectsCreate).not.toHaveBeenCalled();
      expect(projects.get()).toEqual([]);
      expect(toastErrorMock).toHaveBeenCalledTimes(1);
      expect((toastErrorMock.mock.calls[0]?.[0] as string) ?? '').toContain('Client is required');
    } finally {
      console.error = originalError;
    }
  });

  test('add surfaces api error to user via toast', async () => {
    apiMocks.projectsCreate.mockImplementation(() => Promise.reject(new Error('api down')));
    const projects = makeStubSetter<ProjectLike>([]);
    const handlers = makeProjectHandlers({
      setProjects: projects.setter,
      setProjectTasks: makeStubSetter<TaskLike>([]).setter,
      setEntries: makeStubSetter<EntryLike>([]).setter,
    });

    const originalError = console.error;
    console.error = mock(() => {}) as unknown as typeof console.error;
    try {
      await handlers.add({ name: 'P', clientId: 'c1', orderId: 'order-1', offerId: 'of-1' });
      expect(projects.get()).toEqual([]);
      expect(toastErrorMock).toHaveBeenCalledTimes(1);
      expect((toastErrorMock.mock.calls[0]?.[0] as string) ?? '').toContain('api down');
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
      { id: 'p1', clientId: 'c1', name: 'red' },
      { id: 'p2', clientId: 'c2', name: 'blue' },
    ]);
    const handlers = makeProjectHandlers({
      setProjects: projects.setter,
      setProjectTasks: makeStubSetter<TaskLike>([]).setter,
      setEntries: makeStubSetter<EntryLike>([]).setter,
    });

    await handlers.update('p1', { name: 'green' });
    expect(projects.get()[0].name).toBe('green');
    expect(projects.get()[1].name).toBe('blue');
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
