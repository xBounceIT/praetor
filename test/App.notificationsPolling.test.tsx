import { describe, expect, mock, test } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import type { Notification } from '../types';
import { ApiErrorStub } from './helpers/apiErrorStub';
import { clearSpyStateAfterAll } from './helpers/mockCleanup.ts';

/**
 * App.tsx is too tangled to mount the full tree, so we mirror the
 * notifications-polling `useEffect` here 1:1. The test pins the regression
 * from issue #618: when `currentUser` becomes null (logout) while an
 * `api.notifications.list()` call is in flight, the cleanup must mark the
 * effect as cancelled so the late-resolving promise cannot overwrite the
 * cleared state with stale notifications from the previous session.
 */

type NotificationsListResult = { notifications: Notification[]; unreadCount: number };

let resolveList: ((value: NotificationsListResult) => void) | null = null;
const apiList = mock(
  (): Promise<NotificationsListResult> =>
    new Promise<NotificationsListResult>((resolve) => {
      resolveList = resolve;
    }),
);

mock.module('../services/api', () => ({
  default: {
    notifications: {
      list: () => apiList(),
    },
  },
  ApiError: ApiErrorStub,
  getAuthToken: () => null,
  setAuthToken: () => {},
}));

clearSpyStateAfterAll();

type NotificationsState = { items: Notification[]; unreadCount: number };

/** Mirrors the App.tsx notifications-polling effect 1:1. */
const useNotificationsPolling = (
  currentUser: { id: string } | null,
): { state: NotificationsState } => {
  const [state, setState] = useState<NotificationsState>({ items: [], unreadCount: 0 });

  useEffect(() => {
    if (!currentUser) {
      setState({ items: [], unreadCount: 0 });
      return;
    }

    let isCancelled = false;

    const loadNotifications = async () => {
      try {
        const { default: api } = await import('../services/api');
        const data = await api.notifications.list();
        if (isCancelled) return;
        setState({ items: data.notifications, unreadCount: data.unreadCount });
      } catch (err) {
        if (isCancelled) return;
        console.error('Failed to load notifications:', err);
      }
    };

    loadNotifications();
    const interval = setInterval(loadNotifications, 60000);
    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [currentUser]);

  return { state };
};

const makeNotification = (id: string, isRead = false): Notification => ({
  id,
  userId: 'u1',
  type: 'generic',
  title: `notification ${id}`,
  isRead,
  createdAt: 0,
});

describe('App notifications polling cancellation (#618)', () => {
  test('in-flight list() that resolves after logout does not overwrite cleared state', async () => {
    apiList.mockClear();
    resolveList = null;

    const { result, rerender } = renderHook(
      ({ user }: { user: { id: string } | null }) => {
        // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- renderHook callback invokes the hook under test; it is not a state updater.
        return useNotificationsPolling(user);
      },
      { initialProps: { user: { id: 'u1' } as { id: string } | null } },
    );

    await waitFor(() => expect(apiList).toHaveBeenCalledTimes(1));
    const pendingResolve = resolveList as ((value: NotificationsListResult) => void) | null;
    if (!pendingResolve) throw new Error('expected list() to have stored its resolver');

    rerender({ user: null });
    expect(result.current.state).toEqual({ items: [], unreadCount: 0 });

    await act(async () => {
      pendingResolve({
        notifications: [makeNotification('stale-1'), makeNotification('stale-2')],
        unreadCount: 2,
      });
    });

    expect(result.current.state).toEqual({ items: [], unreadCount: 0 });
  });

  // Positive control: guards against a future regression where the
  // cancellation flag is always-firing (e.g. flipped on the wrong code path)
  // which would silently break the steady-state polling.
  test('resolved list() applies to state when the user stays logged in', async () => {
    apiList.mockClear();
    resolveList = null;

    const { result } = renderHook(() => useNotificationsPolling({ id: 'u1' }));

    await waitFor(() => expect(apiList).toHaveBeenCalledTimes(1));
    const pendingResolve = resolveList as ((value: NotificationsListResult) => void) | null;
    if (!pendingResolve) throw new Error('expected list() to have stored its resolver');

    await act(async () => {
      pendingResolve({
        notifications: [makeNotification('n1'), makeNotification('n2', true)],
        unreadCount: 1,
      });
    });

    expect(result.current.state.items.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(result.current.state.unreadCount).toBe(1);
  });
});
