import { describe, expect, mock, test } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { StrictMode, useCallback, useState } from 'react';
import type { Notification } from '../types';
import { ApiErrorStub } from './helpers/apiErrorStub';
import { clearSpyStateAfterAll } from './helpers/mockCleanup.ts';

/**
 * App.tsx is too tangled to mount the full tree, so we mirror
 * `handleDeleteNotification` here. The tests pin: stable callback identity
 * across updates (empty deps), and that the single-state updater inspects
 * and mutates items + unreadCount atomically — a previous ref-based read
 * lagged polling-queued state and drifted the counter downward (#513).
 */

const apiDelete = mock((_id: string): Promise<void> => Promise.resolve());

// Mirror the project convention (see NotificationBell.test.tsx): mock the full
// `services/api` surface so the global mock doesn't leak a partial module into
// other test files that import `ApiError` / `getAuthToken` / `setAuthToken`.
mock.module('../services/api', () => ({
  default: {
    notifications: {
      delete: (id: string) => apiDelete(id),
    },
  },
  ApiError: ApiErrorStub,
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

clearSpyStateAfterAll();

type NotificationsState = { items: Notification[]; unreadCount: number };

type NotificationsHookResult = {
  handleDelete: (id: string) => Promise<void>;
  notifications: Notification[];
  unread: number;
  setState: (next: NotificationsState) => void;
};

/** Mirrors the App.tsx implementation of `handleDeleteNotification` 1:1. */
const useNotificationsCallback = (initial: Notification[]): NotificationsHookResult => {
  const [state, setState] = useState<NotificationsState>({
    items: initial,
    unreadCount: initial.filter((n) => !n.isRead).length,
  });

  const handleDelete = useCallback(async (id: string) => {
    try {
      const { default: api } = await import('../services/api');
      await api.notifications.delete(id);
      setState((prev) => {
        const target = prev.items.find((n) => n.id === id);
        const wasUnread = !!target && !target.isRead;
        return {
          items: prev.items.filter((n) => n.id !== id),
          unreadCount: wasUnread ? Math.max(0, prev.unreadCount - 1) : prev.unreadCount,
        };
      });
    } catch (err) {
      console.error('Failed to delete notification:', err);
    }
  }, []);

  return {
    handleDelete,
    notifications: state.items,
    unread: state.unreadCount,
    setState,
  };
};

const makeNotification = (id: string, isRead = false): Notification => ({
  id,
  userId: 'u1',
  type: 'generic',
  title: `notification ${id}`,
  isRead,
  createdAt: 0,
});

describe('App handleDeleteNotification', () => {
  test('callback identity is stable across notifications updates', async () => {
    const { result, rerender } = renderHook(
      ({ initial }: { initial: Notification[] }) => {
        // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- renderHook callback invokes the hook under test; it is not a state updater.
        return useNotificationsCallback(initial);
      },
      { initialProps: { initial: [makeNotification('n1'), makeNotification('n2')] } },
    );

    const firstIdentity = result.current.handleDelete;

    // Simulate the 60s polling refresh replacing the notifications array
    // entirely. The handler returned to consumers must remain the same
    // function reference.
    act(() => {
      result.current.setState({
        items: [makeNotification('n1'), makeNotification('n2'), makeNotification('n3')],
        unreadCount: 3,
      });
    });
    expect(result.current.handleDelete).toBe(firstIdentity);

    // A parent rerender with a fresh initial array (e.g. switching users)
    // also must not change identity, because the callback's deps are [].
    rerender({ initial: [makeNotification('n9')] });
    expect(result.current.handleDelete).toBe(firstIdentity);
  });

  test('handler decrements unread count only for unread notifications', async () => {
    apiDelete.mockClear();
    const { result } = renderHook(() =>
      useNotificationsCallback([
        makeNotification('unread1', false),
        makeNotification('read1', true),
      ]),
    );

    expect(result.current.unread).toBe(1);

    // Deleting a read notification leaves unread count unchanged.
    await act(async () => {
      await result.current.handleDelete('read1');
    });
    expect(result.current.unread).toBe(1);
    expect(result.current.notifications.map((n) => n.id)).toEqual(['unread1']);

    // Deleting an unread one decrements.
    await act(async () => {
      await result.current.handleDelete('unread1');
    });
    expect(result.current.unread).toBe(0);
    expect(result.current.notifications).toEqual([]);
    expect(apiDelete).toHaveBeenCalledTimes(2);
  });

  test('handler reads the latest notifications (no stale closure)', async () => {
    apiDelete.mockClear();
    const { result } = renderHook(() =>
      useNotificationsCallback([makeNotification('initial', false)]),
    );

    const initialHandler = result.current.handleDelete;

    // Replace the array AFTER the handler closure was captured. The handler
    // must observe the new array via the functional updater's `prev` and
    // correctly find/remove the new id.
    act(() => {
      result.current.setState({
        items: [makeNotification('new-id', false)],
        unreadCount: 1,
      });
    });

    await act(async () => {
      await initialHandler('new-id');
    });

    expect(result.current.notifications).toEqual([]);
    expect(result.current.unread).toBe(0);
  });

  // Regression for issue #513: the previous implementation read the deleted
  // notification's `isRead` from a render-synced ref, then called two separate
  // setters (`setNotifications` + `setUnreadNotificationCount`). When the 60s
  // polling refresh applied a state update that already accounted for the
  // notification being read (e.g. from another tab), the ref could lag — the
  // delete handler would see the notification as unread, decrement again on
  // top of polling's already-applied decrement, and drift the counter
  // downward. The fix collapses both values into a single state object so
  // the delete updater inspects polling's latest applied state inside `prev`
  // and updates atomically.
  test('handler does not double-decrement when polling already marked as read', async () => {
    apiDelete.mockClear();

    const { result } = renderHook(() =>
      useNotificationsCallback([makeNotification('n1', false), makeNotification('n2', false)]),
    );

    expect(result.current.unread).toBe(2);

    // Polling refresh applies: n1 is now read server-side, unreadCount=1.
    act(() => {
      result.current.setState({
        items: [makeNotification('n1', true), makeNotification('n2', false)],
        unreadCount: 1,
      });
    });
    expect(result.current.unread).toBe(1);

    await act(async () => {
      await result.current.handleDelete('n1');
    });

    expect(result.current.notifications.map((n) => n.id)).toEqual(['n2']);
    expect(result.current.unread).toBe(1);
  });

  // Guards against the regression fix over-correcting and skipping valid decrements.
  test('handler decrements when no polling race has occurred', async () => {
    apiDelete.mockClear();
    const { result } = renderHook(() =>
      useNotificationsCallback([makeNotification('n1', false), makeNotification('n2', false)]),
    );

    expect(result.current.unread).toBe(2);

    await act(async () => {
      await result.current.handleDelete('n1');
    });

    expect(result.current.notifications.map((n) => n.id)).toEqual(['n2']);
    expect(result.current.unread).toBe(1);
  });

  // Regression: StrictMode invokes state updaters twice in development to
  // surface side effects. A correct implementation must remain idempotent
  // under that double invocation — items and unreadCount are derived purely
  // from `prev` in the single setState call, so both invocations return the
  // same new state and the decrement applies exactly once.
  test('deleting one unread notification decrements unread by exactly 1 under StrictMode', async () => {
    apiDelete.mockClear();
    const { result } = renderHook(
      () => useNotificationsCallback([makeNotification('only-unread', false)]),
      { wrapper: StrictMode },
    );

    expect(result.current.unread).toBe(1);

    await act(async () => {
      await result.current.handleDelete('only-unread');
    });

    expect(result.current.unread).toBe(0);
    expect(result.current.notifications).toEqual([]);
  });
});
