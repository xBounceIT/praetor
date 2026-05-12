import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ApiErrorStub } from '../helpers/apiErrorStub';

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
    Object.values(apiMocks).forEach((m) => {
      m.mockClear();
    });
  });

  afterEach(() => {
    Object.values(apiMocks).forEach((m) => {
      m.mockReset();
    });
  });

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
    // The recurring generator must receive the freshly-updated task list, not a
    // stale snapshot — otherwise the just-made-recurring task is invisible.
    const passedTasks = generateSpy.mock.calls[0]?.[0] as TaskLike[] | undefined;
    expect(passedTasks).toBeDefined();
    const updatedTask = passedTasks?.find((t) => t.id === 't1');
    expect(updatedTask?.isRecurring).toBe(true);
    expect(updatedTask?.recurrencePattern).toBe('weekly');
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
    });

    await handlers.makeRecurring('t1', 'daily', '2026-05-01');

    // After the awaited makeRecurring resolves, regeneration must have already fired.
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });

  test('passes the updated task list (not stale closure) to generateRecurringEntries', async () => {
    // Regression: when makeTaskHandlers is built from a snapshot of projectTasks that
    // lacks the new task, the old code relied on closure and used the stale list.
    // The fix passes the explicit `nextTasks` array, so the just-updated task is visible.
    apiMocks.tasksUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({
        id,
        name: 'fresh-task',
        projectId: 'p1',
        isRecurring: true,
        ...(updates as object),
      }),
    );
    // Simulate: handlers were built while only an older task existed; the fresh task
    // (`fresh-task`) was just added to state but the closure here still sees it because
    // makeRecurring uses the deps snapshot. After updating `fresh-task` to recurring,
    // the generator must see the updated version.
    const tasksList: TaskLike[] = [
      { id: 't-old', name: 'old', projectId: 'p1', isRecurring: false },
      { id: 't-new', name: 'fresh-task', projectId: 'p1', isRecurring: false },
    ];
    const tasks = makeStubSetter<TaskLike>(tasksList);
    const generateSpy = mock((_tasks?: unknown) => Promise.resolve());
    const handlers = makeTaskHandlers({
      projectTasks: tasks.get() as never,
      setProjectTasks: tasks.setter,
      setEntries: makeStubSetter<EntryLike>([]).setter,
      generateRecurringEntries: generateSpy as never,
    });

    await handlers.makeRecurring('t-new', 'weekly', '2026-05-01');

    const passedTasks = generateSpy.mock.calls[0]?.[0] as TaskLike[] | undefined;
    expect(passedTasks).toBeDefined();
    expect(passedTasks?.length).toBe(2);
    const newTask = passedTasks?.find((t) => t.id === 't-new');
    expect(newTask?.isRecurring).toBe(true);
    expect(newTask?.recurrencePattern).toBe('weekly');
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

    // generateRecurringEntries should still receive the full list (both tasks).
    const passedTasks = generateSpy.mock.calls[0]?.[0] as TaskLike[] | undefined;
    expect(passedTasks?.length).toBe(2);
    expect(passedTasks?.find((t) => t.id === 't2')).toBeDefined();
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
