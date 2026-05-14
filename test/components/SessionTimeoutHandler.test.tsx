import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { installI18nMock } from '../helpers/i18n';
import { clearSpyStateAfterAll } from '../helpers/mockCleanup.ts';

installI18nMock();

const apiAuthMe = mock(() => Promise.resolve({} as unknown));

mock.module('../../services/api', () => ({
  default: {
    auth: {
      me: () => apiAuthMe(),
    },
  },
}));

clearSpyStateAfterAll();

const SessionTimeoutHandler = (await import('../../components/SessionTimeoutHandler')).default;

const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'] as const;

const dispatch = (event: (typeof ACTIVITY_EVENTS)[number]) =>
  act(() => {
    window.dispatchEvent(new Event(event));
  });

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('<SessionTimeoutHandler />', () => {
  beforeEach(() => {
    apiAuthMe.mockReset();
    apiAuthMe.mockImplementation(() => Promise.resolve({} as unknown));
  });

  afterEach(() => {
    cleanup();
  });

  test('attaches each activity listener exactly once on mount', () => {
    const addSpy = spyOn(window, 'addEventListener');
    addSpy.mockClear();

    render(
      <SessionTimeoutHandler onLogout={() => {}} warnAfterMs={60_000} logoutAfterMs={120_000} />,
    );

    for (const eventName of ACTIVITY_EVENTS) {
      const calls = addSpy.mock.calls.filter((call) => call[0] === eventName);
      expect(calls.length).toBe(1);
    }

    addSpy.mockRestore();
  });

  test('does not re-attach listeners when parent re-renders with a new onLogout reference', () => {
    let triggerParentRender: (() => void) | null = null;

    const Parent = () => {
      const [, setTick] = useState(0);
      triggerParentRender = () => setTick((n) => n + 1);
      // Fresh arrow on every parent render — mirrors App.tsx's `() => handleLogout('inactivity')`.
      return (
        <SessionTimeoutHandler onLogout={() => {}} warnAfterMs={60_000} logoutAfterMs={120_000} />
      );
    };

    const addSpy = spyOn(window, 'addEventListener');
    addSpy.mockClear();

    render(<Parent />);

    const countAttachments = (eventName: string) =>
      addSpy.mock.calls.filter((call) => call[0] === eventName).length;

    for (const eventName of ACTIVITY_EVENTS) {
      expect(countAttachments(eventName)).toBe(1);
    }

    // Trigger several parent re-renders, which used to make resetTimers' deps shift
    // and the listener effect re-run on every render.
    act(() => {
      triggerParentRender?.();
      triggerParentRender?.();
      triggerParentRender?.();
    });

    for (const eventName of ACTIVITY_EVENTS) {
      expect(countAttachments(eventName)).toBe(1);
    }

    addSpy.mockRestore();
  });

  test('warning appears after warnAfterMs of inactivity', async () => {
    render(<SessionTimeoutHandler onLogout={() => {}} warnAfterMs={60} logoutAfterMs={10_000} />);

    expect(screen.queryByText('sessionTimeout.title')).toBeNull();

    await waitFor(() => {
      expect(screen.getByText('sessionTimeout.title')).toBeInTheDocument();
    });
  });

  test('user activity resets the warning timer', async () => {
    render(<SessionTimeoutHandler onLogout={() => {}} warnAfterMs={150} logoutAfterMs={10_000} />);

    // Wait < warnAfterMs, then poke the page — warning should not fire for another full window.
    await wait(80);
    await dispatch('mousemove');
    await wait(100);

    expect(screen.queryByText('sessionTimeout.title')).toBeNull();

    // Eventually, with no further activity, the warning still surfaces.
    await waitFor(
      () => {
        expect(screen.getByText('sessionTimeout.title')).toBeInTheDocument();
      },
      { timeout: 500 },
    );
  });

  test('user activity is ignored once the warning is visible', async () => {
    const onLogout = mock(() => {});

    render(<SessionTimeoutHandler onLogout={onLogout} warnAfterMs={40} logoutAfterMs={10_000} />);

    await waitFor(() => {
      expect(screen.getByText('sessionTimeout.title')).toBeInTheDocument();
    });

    await dispatch('mousemove');
    await dispatch('keydown');
    await wait(30);

    // Warning must remain — only "Stay logged in" should be able to dismiss it.
    expect(screen.getByText('sessionTimeout.title')).toBeInTheDocument();
  });

  test('onLogout fires after logoutAfterMs of inactivity', async () => {
    const onLogout = mock(() => {});

    render(<SessionTimeoutHandler onLogout={onLogout} warnAfterMs={20} logoutAfterMs={80} />);

    await waitFor(() => expect(onLogout).toHaveBeenCalledTimes(1), { timeout: 500 });
  });

  test('removes all activity listeners on unmount', () => {
    const removeSpy = spyOn(window, 'removeEventListener');
    removeSpy.mockClear();

    const view = render(
      <SessionTimeoutHandler onLogout={() => {}} warnAfterMs={60_000} logoutAfterMs={120_000} />,
    );

    view.unmount();

    for (const eventName of ACTIVITY_EVENTS) {
      const calls = removeSpy.mock.calls.filter((call) => call[0] === eventName);
      expect(calls.length).toBeGreaterThanOrEqual(1);
    }

    removeSpy.mockRestore();
  });
});
