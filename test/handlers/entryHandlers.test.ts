import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ApiErrorStub } from '../helpers/apiErrorStub';
import { registerMockCleanup } from '../helpers/mockCleanup.ts';

const apiMocks = {
  entriesCreate: mock(
    (data: unknown): Promise<unknown> =>
      Promise.resolve({ id: 'e-new', createdAt: 1000, ...(data as object) }),
  ),
  entriesUpdate: mock(
    (id: string, updates: unknown): Promise<unknown> =>
      Promise.resolve({ id, ...(updates as object) }),
  ),
  entriesDelete: mock((_id: string): Promise<void> => Promise.resolve()),
};

mock.module('../../services/api', () => ({
  default: {
    entries: {
      create: (data: unknown) => apiMocks.entriesCreate(data),
      update: (id: string, updates: unknown) => apiMocks.entriesUpdate(id, updates),
      delete: (id: string) => apiMocks.entriesDelete(id),
    },
  },
  ApiError: ApiErrorStub,
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

registerMockCleanup();

const { makeEntryHandlers } = await import('../../hooks/handlers/entryHandlers');

type EntryLike = {
  id: string;
  createdAt: number;
  userId?: string;
  hourlyCost?: number;
  task?: string;
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

describe('makeEntryHandlers', () => {
  beforeEach(() => {
    for (const m of Object.values(apiMocks)) m.mockClear();
  });

  afterEach(() => {
    for (const m of Object.values(apiMocks)) m.mockReset();
  });

  test('add returns early when no current user', async () => {
    const entries = makeStubSetter<EntryLike>([]);
    const handlers = makeEntryHandlers({
      currentUser: null,
      viewingUserId: '',
      setEntries: entries.setter,
    });

    await handlers.add({ task: 'no-op' } as never);
    expect(apiMocks.entriesCreate).not.toHaveBeenCalled();
    expect(entries.get()).toEqual([]);
  });

  test('add prepends created entry using viewingUserId override', async () => {
    apiMocks.entriesCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'e-new', createdAt: 1000, ...(data as object) }),
    );
    const entries = makeStubSetter<EntryLike>([{ id: 'e1', createdAt: 500 }]);
    const handlers = makeEntryHandlers({
      currentUser: { id: 'u-current', costPerHour: 50 } as never,
      viewingUserId: 'u-viewing',
      setEntries: entries.setter,
    });

    await handlers.add({ task: 'work' } as never);

    const callArg = apiMocks.entriesCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.userId).toBe('u-viewing');
    expect(callArg.hourlyCost).toBe(50);
    expect(callArg.task).toBe('work');
    expect(entries.get()).toHaveLength(2);
    expect(entries.get()[0].id).toBe('e-new');
  });

  test('add falls back to currentUser id when viewingUserId is empty', async () => {
    apiMocks.entriesCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'e-new', createdAt: 1, ...(data as object) }),
    );
    const handlers = makeEntryHandlers({
      currentUser: { id: 'u-current', costPerHour: 0 } as never,
      viewingUserId: '',
      setEntries: makeStubSetter<EntryLike>([]).setter,
    });

    await handlers.add({ task: 'work' } as never);
    const callArg = apiMocks.entriesCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.userId).toBe('u-current');
    expect(callArg.hourlyCost).toBe(0);
  });

  test('add swallows errors and alerts user', async () => {
    apiMocks.entriesCreate.mockImplementation(() => Promise.reject(new Error('boom')));
    const entries = makeStubSetter<EntryLike>([{ id: 'e1', createdAt: 1 }]);
    const handlers = makeEntryHandlers({
      currentUser: { id: 'u', costPerHour: 10 } as never,
      viewingUserId: '',
      setEntries: entries.setter,
    });

    const restore = silenceConsole();
    try {
      await handlers.add({ task: 'fail' } as never);
      expect(entries.get()).toEqual([{ id: 'e1', createdAt: 1 }]);
    } finally {
      restore();
    }
  });

  test('addBulk returns early when no current user', async () => {
    const entries = makeStubSetter<EntryLike>([]);
    const handlers = makeEntryHandlers({
      currentUser: null,
      viewingUserId: '',
      setEntries: entries.setter,
    });

    await handlers.addBulk([{ task: 'a' } as never]);
    expect(apiMocks.entriesCreate).not.toHaveBeenCalled();
  });

  test('addBulk creates and prepends sorted by createdAt desc', async () => {
    let counter = 0;
    apiMocks.entriesCreate.mockImplementation((data: unknown) => {
      counter += 1;
      return Promise.resolve({
        id: `e-new-${counter}`,
        createdAt: counter * 100,
        ...(data as object),
      });
    });
    const entries = makeStubSetter<EntryLike>([{ id: 'e0', createdAt: 50 }]);
    const handlers = makeEntryHandlers({
      currentUser: { id: 'u1', costPerHour: 25 } as never,
      viewingUserId: 'u2',
      setEntries: entries.setter,
    });

    await handlers.addBulk([{ task: 'a' } as never, { task: 'b' } as never]);

    expect(apiMocks.entriesCreate).toHaveBeenCalledTimes(2);
    const result = entries.get();
    expect(result.map((e) => e.createdAt)).toEqual([200, 100, 50]);
  });

  test('addBulk swallows errors', async () => {
    apiMocks.entriesCreate.mockImplementation(() => Promise.reject(new Error('boom')));
    const entries = makeStubSetter<EntryLike>([]);
    const handlers = makeEntryHandlers({
      currentUser: { id: 'u', costPerHour: 0 } as never,
      viewingUserId: '',
      setEntries: entries.setter,
    });

    const restore = silenceConsole();
    try {
      await handlers.addBulk([{ task: 'a' } as never]);
      expect(entries.get()).toEqual([]);
    } finally {
      restore();
    }
  });

  test('delete removes matching entry', async () => {
    apiMocks.entriesDelete.mockImplementation(() => Promise.resolve());
    const entries = makeStubSetter<EntryLike>([
      { id: 'e1', createdAt: 1 },
      { id: 'e2', createdAt: 2 },
    ]);
    const handlers = makeEntryHandlers({
      currentUser: { id: 'u' } as never,
      viewingUserId: '',
      setEntries: entries.setter,
    });

    await handlers.delete('e1');
    expect(apiMocks.entriesDelete).toHaveBeenCalledWith('e1');
    expect(entries.get()).toEqual([{ id: 'e2', createdAt: 2 }]);
  });

  test('delete swallows errors', async () => {
    apiMocks.entriesDelete.mockImplementation(() => Promise.reject(new Error('nope')));
    const entries = makeStubSetter<EntryLike>([{ id: 'e1', createdAt: 1 }]);
    const handlers = makeEntryHandlers({
      currentUser: { id: 'u' } as never,
      viewingUserId: '',
      setEntries: entries.setter,
    });

    const restore = silenceConsole();
    try {
      await handlers.delete('e1');
      expect(entries.get()).toEqual([{ id: 'e1', createdAt: 1 }]);
    } finally {
      restore();
    }
  });

  test('update replaces matching entry', async () => {
    apiMocks.entriesUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, createdAt: 5, ...(updates as object) }),
    );
    const entries = makeStubSetter<EntryLike>([
      { id: 'e1', createdAt: 1, task: 'A' },
      { id: 'e2', createdAt: 2, task: 'B' },
    ]);
    const handlers = makeEntryHandlers({
      currentUser: { id: 'u' } as never,
      viewingUserId: '',
      setEntries: entries.setter,
    });

    await handlers.update('e1', { task: 'A2' } as never);
    expect(entries.get()[0]).toEqual({ id: 'e1', createdAt: 5, task: 'A2' });
    expect(entries.get()[1]).toEqual({ id: 'e2', createdAt: 2, task: 'B' });
  });

  test('update swallows errors', async () => {
    apiMocks.entriesUpdate.mockImplementation(() => Promise.reject(new Error('boom')));
    const entries = makeStubSetter<EntryLike>([{ id: 'e1', createdAt: 1, task: 'A' }]);
    const handlers = makeEntryHandlers({
      currentUser: { id: 'u' } as never,
      viewingUserId: '',
      setEntries: entries.setter,
    });

    const restore = silenceConsole();
    try {
      await handlers.update('e1', { task: 'A2' } as never);
      expect(entries.get()).toEqual([{ id: 'e1', createdAt: 1, task: 'A' }]);
    } finally {
      restore();
    }
  });
});
