import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

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
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

const { makeTaskHandlers } = await import('../../hooks/handlers/taskHandlers');

type TaskLike = {
  id: string;
  name: string;
  projectId: string;
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

describe('makeTaskHandlers.makeRecurring', () => {
  beforeEach(() => {
    Object.values(apiMocks).forEach((m) => m.mockClear());
  });

  afterEach(() => {
    Object.values(apiMocks).forEach((m) => m.mockReset());
  });

  test('first-time recurring: skips placeholder cleanup, updates task, regenerates', async () => {
    apiMocks.tasksUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, name: 'task-A', projectId: 'p1', ...(updates as object) }),
    );
    const tasks = makeStubSetter<TaskLike>([
      { id: 't1', name: 'task-A', projectId: 'p1', isRecurring: false },
    ]);
    const entries = makeStubSetter<EntryLike>([]);
    const generateSpy = mock(() => Promise.resolve());
    const handlers = makeTaskHandlers({
      projectTasks: tasks.get() as never,
      setProjectTasks: tasks.setter,
      setEntries: entries.setter,
      generateRecurringEntries: generateSpy,
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
    });

    await handlers.makeRecurring('t1', 'daily');

    const [, updates] = apiMocks.tasksUpdate.mock.calls[0] as [string, Record<string, unknown>];
    expect(updates.recurrenceDuration).toBeUndefined();
    expect(updates.recurrenceEnd).toBeUndefined();
    // recurrenceStart defaults to today (YYYY-MM-DD shape) when omitted.
    expect(updates.recurrenceStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
