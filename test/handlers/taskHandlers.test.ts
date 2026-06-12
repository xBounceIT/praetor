import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ApiErrorStub } from '../helpers/apiErrorStub';
import { clearSpyStateAfterAll } from '../helpers/mockCleanup.ts';

const apiMocks = {
  tasksUpdate: mock(
    (id: string, updates: unknown): Promise<unknown> =>
      Promise.resolve({ id, name: 'task', projectId: 'p1', ...(updates as object) }),
  ),
  entriesBulkDelete: mock((..._args: unknown[]): Promise<void> => Promise.resolve()),
};

mock.module('../../services/api', () => ({
  default: {
    tasks: {
      update: (id: string, updates: unknown) => apiMocks.tasksUpdate(id, updates),
    },
    entries: {
      bulkDelete: (...args: unknown[]) => apiMocks.entriesBulkDelete(...args),
    },
  },
  ApiError: ApiErrorStub,
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

clearSpyStateAfterAll();

const { createTaskUpdateQueueState, makeTaskHandlers } = await import(
  '../../hooks/handlers/taskHandlers'
);

type TaskLike = {
  id: string;
  name: string;
  projectId: string;
  revenue?: number;
  isRecurring?: boolean;
  recurrencePattern?: string;
  recurrenceStart?: string;
  recurrenceEnd?: string;
  recurrenceDuration?: number;
};
type EntryLike = {
  id: string;
  projectId: string;
  task: string;
  isPlaceholder?: boolean;
};

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

const deferValue = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  Object.values(apiMocks).forEach((m) => {
    m.mockClear();
  });
});

afterEach(() => {
  Object.values(apiMocks).forEach((m) => {
    m.mockReset();
  });
});

describe('makeTaskHandlers.update', () => {
  test('serializes same-task revenue edits so the latest value wins locally and on the server', async () => {
    const requests: Array<{
      id: string;
      updates: Partial<TaskLike>;
      deferred: ReturnType<typeof deferValue<TaskLike>>;
    }> = [];
    apiMocks.tasksUpdate.mockImplementation((id: string, updates: unknown) => {
      const deferred = deferValue<TaskLike>();
      requests.push({ id, updates: updates as Partial<TaskLike>, deferred });
      return deferred.promise;
    });
    const tasks = makeStubSetter<TaskLike>([
      { id: 't1', name: 'task-A', projectId: 'p1', revenue: 10 },
    ]);
    const handlers = makeTaskHandlers({
      projectTasks: tasks.get() as never,
      setProjectTasks: tasks.setter,
      setEntries: makeStubSetter<EntryLike>([]).setter,
      generateRecurringEntries: mock(() => Promise.resolve()),
      taskUpdateQueueState: createTaskUpdateQueueState(),
    });

    const firstUpdate = handlers.update('t1', { revenue: 100 });
    const secondUpdate = handlers.update('t1', { revenue: 250 });
    await Promise.resolve();

    expect(requests).toHaveLength(1);
    expect(requests[0].updates).toEqual({ revenue: 100 });

    requests[0].deferred.resolve({ id: 't1', name: 'task-A', projectId: 'p1', revenue: 100 });
    await firstUpdate;
    await Promise.resolve();

    expect(tasks.get()[0].revenue).toBe(100);
    expect(requests).toHaveLength(2);
    expect(requests[1].updates).toEqual({ revenue: 250 });

    requests[1].deferred.resolve({ id: 't1', name: 'task-A', projectId: 'p1', revenue: 250 });
    await secondUpdate;

    expect(tasks.get()[0].revenue).toBe(250);
  });

  test('keeps the last committed task value when a newer queued edit fails', async () => {
    const requests: Array<{
      updates: Partial<TaskLike>;
      deferred: ReturnType<typeof deferValue<TaskLike>>;
    }> = [];
    apiMocks.tasksUpdate.mockImplementation((_id: string, updates: unknown) => {
      const deferred = deferValue<TaskLike>();
      requests.push({ updates: updates as Partial<TaskLike>, deferred });
      return deferred.promise;
    });
    const tasks = makeStubSetter<TaskLike>([
      { id: 't1', name: 'task-A', projectId: 'p1', revenue: 10 },
    ]);
    const handlers = makeTaskHandlers({
      projectTasks: tasks.get() as never,
      setProjectTasks: tasks.setter,
      setEntries: makeStubSetter<EntryLike>([]).setter,
      generateRecurringEntries: mock(() => Promise.resolve()),
      taskUpdateQueueState: createTaskUpdateQueueState(),
    });

    const originalError = console.error;
    console.error = mock(() => {}) as unknown as typeof console.error;
    try {
      const firstUpdate = handlers.update('t1', { revenue: 100 });
      const secondUpdate = handlers.update('t1', { revenue: 250 });
      await Promise.resolve();

      requests[0].deferred.resolve({ id: 't1', name: 'task-A', projectId: 'p1', revenue: 100 });
      await firstUpdate;
      await Promise.resolve();

      expect(tasks.get()[0].revenue).toBe(100);
      expect(requests).toHaveLength(2);
      expect(requests[1].updates).toEqual({ revenue: 250 });

      requests[1].deferred.reject(new Error('validation failed'));
      await secondUpdate;

      expect(tasks.get()[0].revenue).toBe(100);
    } finally {
      console.error = originalError;
    }
  });
});

describe('makeTaskHandlers.makeRecurring', () => {
  test('first-time recurring: skips placeholder cleanup, updates task, regenerates', async () => {
    apiMocks.tasksUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, name: 'task-A', projectId: 'p1', ...(updates as object) }),
    );
    const tasks = makeStubSetter<TaskLike>([
      { id: 't1', name: 'task-A', projectId: 'p1', isRecurring: false },
    ]);
    const entries = makeStubSetter<EntryLike>([]);
    const generateSpy = mock((_tasks?: unknown) => Promise.resolve());
    const handlers = makeTaskHandlers({
      projectTasks: tasks.get() as never,
      setProjectTasks: tasks.setter,
      setEntries: entries.setter,
      generateRecurringEntries: generateSpy as never,
      taskUpdateQueueState: createTaskUpdateQueueState(),
    });

    await handlers.makeRecurring('t1', 'weekly', '2026-05-01', '2026-12-01', 8);

    expect(apiMocks.entriesBulkDelete).not.toHaveBeenCalled();
    expect(apiMocks.tasksUpdate).toHaveBeenCalledTimes(1);
    const [, updates] = apiMocks.tasksUpdate.mock.calls[0] as [string, Record<string, unknown>];
    expect(updates.isRecurring).toBe(true);
    expect(updates.recurrencePattern).toBe('weekly');
    expect(updates.recurrenceStart).toBe('2026-05-01');
    expect(updates.recurrenceEnd).toBe('2026-12-01');
    expect(updates.recurrenceDuration).toBe(8);
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });

  test('regenerates synchronously without a setTimeout race', async () => {
    // This test fails on the legacy `setTimeout(() => void generateRecurringEntries(), 100)`
    // implementation because the generator runs asynchronously after makeRecurring resolves.
    // After the fix, generateRecurringEntries is awaited inline.
    apiMocks.tasksUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, name: 'task-A', projectId: 'p1', ...(updates as object) }),
    );
    const tasks = makeStubSetter<TaskLike>([
      { id: 't1', name: 'task-A', projectId: 'p1', isRecurring: false },
    ]);
    const generateSpy = mock((_tasks?: unknown) => Promise.resolve());
    const handlers = makeTaskHandlers({
      projectTasks: tasks.get() as never,
      setProjectTasks: tasks.setter,
      setEntries: makeStubSetter<EntryLike>([]).setter,
      generateRecurringEntries: generateSpy as never,
      taskUpdateQueueState: createTaskUpdateQueueState(),
    });

    await handlers.makeRecurring('t1', 'daily', '2026-05-01');

    // After the awaited makeRecurring resolves, regeneration must have already fired.
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });

  test('does not clobber a concurrent task add that lands during the api update await', async () => {
    // Regression: building the next list from a closed-over snapshot of
    // projectTasks would overwrite any task added/edited while the
    // api.tasks.update await was in flight. Functional updater fixes this.
    let resolveUpdate: (value: TaskLike) => void = () => {};
    apiMocks.tasksUpdate.mockImplementation(
      () =>
        new Promise<TaskLike>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const tasks = makeStubSetter<TaskLike>([
      { id: 't1', name: 'orig', projectId: 'p1', isRecurring: false },
    ]);
    const setTasks = tasks.setter as unknown as (
      updater: TaskLike[] | ((prev: TaskLike[]) => TaskLike[]),
    ) => void;
    const generateSpy = mock((_tasks?: unknown) => Promise.resolve());
    const handlers = makeTaskHandlers({
      projectTasks: tasks.get() as never,
      setProjectTasks: tasks.setter,
      setEntries: makeStubSetter<EntryLike>([]).setter,
      generateRecurringEntries: generateSpy as never,
      taskUpdateQueueState: createTaskUpdateQueueState(),
    });

    const makeRecurringPromise = handlers.makeRecurring('t1', 'weekly', '2026-05-01');

    // Simulate another flow (e.g. user adds a new task) while the api call
    // is in flight. Using the functional updater is the only safe way for the
    // handler to merge updates with this concurrent change.
    setTasks((prev) => [
      ...prev,
      { id: 't2', name: 'added-concurrently', projectId: 'p1', isRecurring: false },
    ]);

    resolveUpdate({
      id: 't1',
      name: 'orig',
      projectId: 'p1',
      isRecurring: true,
      recurrencePattern: 'weekly',
    });
    await makeRecurringPromise;

    // The concurrent task must still be present; the recurring update is applied.
    const finalTasks = tasks.get();
    expect(finalTasks.length).toBe(2);
    expect(finalTasks.find((t) => t.id === 't1')?.isRecurring).toBe(true);
    expect(finalTasks.find((t) => t.id === 't2')?.name).toBe('added-concurrently');

    expect(generateSpy).toHaveBeenCalledTimes(1);
  });

  test('editing already-recurring task: clears placeholder entries before update', async () => {
    apiMocks.tasksUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, name: 'task-A', projectId: 'p1', ...(updates as object) }),
    );
    const tasks = makeStubSetter<TaskLike>([
      {
        id: 't1',
        name: 'task-A',
        projectId: 'p1',
        isRecurring: true,
        recurrencePattern: 'weekly',
      },
    ]);
    const entries = makeStubSetter<EntryLike>([
      { id: 'e1', projectId: 'p1', task: 'task-A', isPlaceholder: true },
      { id: 'e2', projectId: 'p1', task: 'task-A', isPlaceholder: false }, // logged time
      { id: 'e3', projectId: 'p1', task: 'task-A', isPlaceholder: true },
      { id: 'e4', projectId: 'p2', task: 'task-A', isPlaceholder: true }, // different project
      { id: 'e5', projectId: 'p1', task: 'other-task', isPlaceholder: true }, // different task
    ]);
    const handlers = makeTaskHandlers({
      projectTasks: tasks.get() as never,
      setProjectTasks: tasks.setter,
      setEntries: entries.setter,
      generateRecurringEntries: mock(() => Promise.resolve()),
      taskUpdateQueueState: createTaskUpdateQueueState(),
    });

    await handlers.makeRecurring('t1', 'monthly', '2026-05-01', undefined, 4);

    expect(apiMocks.entriesBulkDelete).toHaveBeenCalledTimes(1);
    const [projectId, taskName, opts] = apiMocks.entriesBulkDelete.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(projectId).toBe('p1');
    expect(taskName).toBe('task-A');
    expect(opts).toEqual({ placeholderOnly: true });

    // Local state: only same-project, same-task placeholders are removed.
    // Logged entries and entries for other projects/tasks are preserved.
    const remaining = entries.get();
    expect(remaining.map((e) => e.id).sort()).toEqual(['e2', 'e4', 'e5']);
  });

  test('falsy duration is forwarded as-is (undefined stays undefined)', async () => {
    apiMocks.tasksUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, name: 'task-A', projectId: 'p1', ...(updates as object) }),
    );
    const tasks = makeStubSetter<TaskLike>([
      { id: 't1', name: 'task-A', projectId: 'p1', isRecurring: false },
    ]);
    const handlers = makeTaskHandlers({
      projectTasks: tasks.get() as never,
      setProjectTasks: tasks.setter,
      setEntries: makeStubSetter<EntryLike>([]).setter,
      generateRecurringEntries: mock(() => Promise.resolve()),
      taskUpdateQueueState: createTaskUpdateQueueState(),
    });

    await handlers.makeRecurring('t1', 'daily');

    const [, updates] = apiMocks.tasksUpdate.mock.calls[0] as [string, Record<string, unknown>];
    expect(updates.recurrenceDuration).toBeUndefined();
    expect(updates.recurrenceEnd).toBeUndefined();
    // recurrenceStart defaults to today (YYYY-MM-DD shape) when omitted.
    expect(updates.recurrenceStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
