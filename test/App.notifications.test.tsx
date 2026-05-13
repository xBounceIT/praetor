import { describe, expect, mock, test } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { StrictMode, useCallback, useRef, useState } from 'react';
import type { Notification } from '../types';
import { ApiErrorStub } from './helpers/apiErrorStub';

/**
 * App.tsx's `handleDeleteNotification` is too tangled to mount the full tree
 * for this assertion, so we mirror its useCallback shape here. The point of
 * this test is to lock the dependency array: the previous implementation
 * captured `notifications` in its deps, so the callback identity churned on
 * every 60-second poll. Each render of the parent that subscribed to it
 * (NotificationBell, Layout) would re-render unnecessarily, and any consumer
 * memoizing on the callback would invalidate its cache. The fix uses an empty
 * dep array with a functional updater.
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

type NotificationsHookResult = {
  handleDelete: (id: string) => Promise<void>;
  notifications: Notification[];
  unread: number;
  setNotifications: (next: Notification[]) => void;
};

/** Mirrors the App.tsx implementation of `handleDeleteNotification` 1:1. */
const useNotificationsCallback = (initial: Notification[]): NotificationsHookResult => {
  const [notifications, setNotifications] = useState<Notification[]>(initial);
  const [unread, setUnreadNotificationCount] = useState<number>(
    initial.filter((n) => !n.isRead).length,
  );
  const notificationsRef = useRef<Notification[]>(notifications);
  notificationsRef.current = notifications;

  const handleDelete = useCallback(async (id: string) => {
    try {
      const { default: api } = await import('../services/api');
      await api.notifications.delete(id);
      const target = notificationsRef.current.find((n) => n.id === id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      if (target && !target.isRead) {
        setUnreadNotificationCount((c) => Math.max(0, c - 1));
      }
    } catch (err) {
      console.error('Failed to delete notification:', err);
    }
  }, []);

  return { handleDelete, notifications, unread, setNotifications };
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
      ({ initial }: { initial: Notification[] }) => useNotificationsCallback(initial),
      { initialProps: { initial: [makeNotification('n1'), makeNotification('n2')] } },
    );

    const firstIdentity = result.current.handleDelete;

    // Simulate the 60s polling refresh replacing the notifications array
    // entirely. The handler returned to consumers must remain the same
    // function reference.
    act(() => {
      result.current.setNotifications([
        makeNotification('n1'),
        makeNotification('n2'),
        makeNotification('n3'),
      ]);
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

  test('handler reads the latest notifications via the ref (no stale closure)', async () => {
    apiDelete.mockClear();
    const { result } = renderHook(() =>
      useNotificationsCallback([makeNotification('initial', false)]),
    );

    const initialHandler = result.current.handleDelete;

    // Replace the array AFTER the handler closure was captured. The handler
    // must observe the new array (because notificationsRef is synced in
    // render) and correctly find/remove the new id.
    act(() => {
      result.current.setNotifications([makeNotification('new-id', false)]);
    });

    await act(async () => {
      await initialHandler('new-id');
    });

    expect(result.current.notifications).toEqual([]);
    expect(result.current.unread).toBe(0);
  });

  // Regression: StrictMode invokes state updaters twice in development to
  // surface side effects. The previous implementation nested
  // `setUnreadNotificationCount` inside the `setNotifications` updater, which
  // queued the decrement twice and made the unread count drop by 2 for a
  // single delete. The fix moves the decrement out of the updater; this test
  // pins that behavior.
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
