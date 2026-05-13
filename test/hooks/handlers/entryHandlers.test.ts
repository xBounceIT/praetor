import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { useMemo } from 'react';
import { clearSpyStateAfterAll } from '../../helpers/mockCleanup.ts';

const apiMocks = {
  entriesCreate: mock(
    (data: unknown): Promise<unknown> =>
      Promise.resolve({ id: 'e-new', createdAt: 1, ...(data as object) }),
  ),
  entriesUpdate: mock(
    (id: string, updates: unknown): Promise<unknown> =>
      Promise.resolve({ id, ...(updates as object) }),
  ),
  entriesDelete: mock((_id: string): Promise<void> => Promise.resolve()),
};

mock.module('../../../services/api', () => ({
  default: {
    entries: {
      create: (data: unknown) => apiMocks.entriesCreate(data),
      update: (id: string, updates: unknown) => apiMocks.entriesUpdate(id, updates),
      delete: (id: string) => apiMocks.entriesDelete(id),
    },
  },
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

clearSpyStateAfterAll();

const { makeEntryHandlers } = await import('../../../hooks/handlers/entryHandlers');

type UserLike = { id: string; costPerHour?: number };
type TimeEntryLike = { id: string; userId: string; createdAt: number };

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

describe('makeEntryHandlers', () => {
  beforeEach(() => {
    apiMocks.entriesCreate.mockClear();
    apiMocks.entriesUpdate.mockClear();
    apiMocks.entriesDelete.mockClear();
  });

  afterEach(() => {
    apiMocks.entriesCreate.mockReset();
    apiMocks.entriesUpdate.mockReset();
    apiMocks.entriesDelete.mockReset();
  });

  test('add uses viewingUserId when set', async () => {
    apiMocks.entriesCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'e-new', createdAt: 1, ...(data as object) }),
    );
    const entries = makeStubSetter<TimeEntryLike>([]);
    const handlers = makeEntryHandlers({
      currentUser: { id: 'me', costPerHour: 50 } as never,
      viewingUserId: 'other-user',
      setEntries: entries.setter,
    });

    await handlers.add({ duration: 1 } as never);

    expect(apiMocks.entriesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'other-user', hourlyCost: 50 }),
    );
  });

  test('add falls back to currentUser.id when viewingUserId is empty', async () => {
    apiMocks.entriesCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: 'e-new', createdAt: 1, ...(data as object) }),
    );
    const entries = makeStubSetter<TimeEntryLike>([]);
    const handlers = makeEntryHandlers({
      currentUser: { id: 'me', costPerHour: 50 } as never,
      viewingUserId: '',
      setEntries: entries.setter,
    });

    await handlers.add({ duration: 1 } as never);

    expect(apiMocks.entriesCreate).toHaveBeenCalledWith(expect.objectContaining({ userId: 'me' }));
  });

  test('add does nothing when currentUser is null', async () => {
    const entries = makeStubSetter<TimeEntryLike>([]);
    const handlers = makeEntryHandlers({
      currentUser: null,
      viewingUserId: 'whatever',
      setEntries: entries.setter,
    });

    await handlers.add({ duration: 1 } as never);

    expect(apiMocks.entriesCreate).not.toHaveBeenCalled();
  });

  test('addBulk routes every entry to viewingUserId', async () => {
    apiMocks.entriesCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: `e-${Math.random()}`, createdAt: Date.now(), ...(data as object) }),
    );
    const entries = makeStubSetter<TimeEntryLike>([]);
    const handlers = makeEntryHandlers({
      currentUser: { id: 'me', costPerHour: 75 } as never,
      viewingUserId: 'other-user',
      setEntries: entries.setter,
    });

    await handlers.addBulk([{ duration: 1 } as never, { duration: 2 } as never]);

    expect(apiMocks.entriesCreate).toHaveBeenCalledTimes(2);
    for (const call of apiMocks.entriesCreate.mock.calls) {
      expect((call[0] as { userId: string }).userId).toBe('other-user');
      expect((call[0] as { hourlyCost: number }).hourlyCost).toBe(75);
    }
  });

  test('update calls api.entries.update and replaces matching entry', async () => {
    apiMocks.entriesUpdate.mockImplementation((id: string, updates: unknown) =>
      Promise.resolve({ id, userId: 'me', createdAt: 1, ...(updates as object) }),
    );
    const entries = makeStubSetter<TimeEntryLike>([
      { id: 'e1', userId: 'me', createdAt: 1 },
      { id: 'e2', userId: 'me', createdAt: 2 },
    ]);
    const handlers = makeEntryHandlers({
      currentUser: { id: 'me' } as never,
      viewingUserId: '',
      setEntries: entries.setter,
    });

    await handlers.update('e1', { duration: 99 } as never);

    expect(apiMocks.entriesUpdate).toHaveBeenCalledWith('e1', { duration: 99 });
    expect(entries.get()[0]).toMatchObject({ id: 'e1', duration: 99 });
  });

  test('delete calls api.entries.delete and removes the entry', async () => {
    apiMocks.entriesDelete.mockImplementation(() => Promise.resolve());
    const entries = makeStubSetter<TimeEntryLike>([
      { id: 'e1', userId: 'me', createdAt: 1 },
      { id: 'e2', userId: 'me', createdAt: 2 },
    ]);
    const handlers = makeEntryHandlers({
      currentUser: { id: 'me' } as never,
      viewingUserId: '',
      setEntries: entries.setter,
    });

    await handlers.delete('e1');

    expect(apiMocks.entriesDelete).toHaveBeenCalledWith('e1');
    expect(entries.get()).toEqual([{ id: 'e2', userId: 'me', createdAt: 2 }]);
  });

  const lastCreateArg = <K extends string>(key: K) =>
    (apiMocks.entriesCreate.mock.calls.at(-1)?.[0] as Record<K, unknown>)[key];

  // These tests verify that handlers see fresh user-identity values when the
  // factory is rebuilt under correct memoization. They don't directly mirror
  // App.tsx's `[currentUser, viewingUserId]` dep array — each case varies
  // only one of the two — but together they cover both axes of the invariant.
  // A drop of either dep in App.tsx would still leak through if the dropped
  // value happened to be the constant one in the matching test, so these are
  // best-effort coverage rather than a hard guarantee.
  test('handlers see the latest viewingUserId after a state change', async () => {
    apiMocks.entriesCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: `e-${Date.now()}`, createdAt: Date.now(), ...(data as object) }),
    );

    const setEntries = makeStubSetter<TimeEntryLike>([]).setter;
    const currentUser = { id: 'me', costPerHour: 10 } as never;

    const { result, rerender } = renderHook(
      ({ viewingUserId }: { viewingUserId: string }) =>
        useMemo(
          () => makeEntryHandlers({ currentUser, viewingUserId, setEntries }),
          [viewingUserId],
        ),
      { initialProps: { viewingUserId: 'user-A' } },
    );

    await act(async () => {
      await result.current.add({ duration: 1 } as never);
    });
    expect(lastCreateArg('userId')).toBe('user-A');

    rerender({ viewingUserId: 'user-B' });

    await act(async () => {
      await result.current.add({ duration: 1 } as never);
    });
    expect(lastCreateArg('userId')).toBe('user-B');
  });

  test('handlers see the latest currentUser cost after a state change', async () => {
    apiMocks.entriesCreate.mockImplementation((data: unknown) =>
      Promise.resolve({ id: `e-${Date.now()}`, createdAt: Date.now(), ...(data as object) }),
    );

    const setEntries = makeStubSetter<TimeEntryLike>([]).setter;

    const { result, rerender } = renderHook(
      ({ user }: { user: UserLike }) =>
        useMemo(
          () =>
            makeEntryHandlers({
              currentUser: user as never,
              viewingUserId: '',
              setEntries,
            }),
          [user],
        ),
      { initialProps: { user: { id: 'me', costPerHour: 10 } } },
    );

    await act(async () => {
      await result.current.add({ duration: 1 } as never);
    });
    expect(lastCreateArg('hourlyCost')).toBe(10);

    rerender({ user: { id: 'me', costPerHour: 99 } });

    await act(async () => {
      await result.current.add({ duration: 1 } as never);
    });
    expect(lastCreateArg('hourlyCost')).toBe(99);
  });
});
