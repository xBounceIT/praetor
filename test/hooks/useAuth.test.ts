import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ApiErrorStub } from '../helpers/apiErrorStub';
import { clearSpyStateAfterAll } from '../helpers/mockCleanup.ts';

const apiMocks = {
  authMe: mock((): Promise<unknown> => Promise.resolve({ id: 'u1' })),
  authSwitchRole: mock(
    (_roleId: string): Promise<unknown> => Promise.resolve({ user: { id: 'u1' }, token: 't1' }),
  ),
  authLogout: mock(
    (): Promise<{ endSessionUrl: string | null }> => Promise.resolve({ endSessionUrl: null }),
  ),
  settingsGet: mock(
    (): Promise<unknown> => Promise.resolve({ fullName: '', email: '', language: 'auto' }),
  ),
};

const tokenStore = { token: null as string | null };
const setAuthTokenMock = mock((token: string | null) => {
  tokenStore.token = token;
});
const getAuthTokenMock = mock(() => tokenStore.token);

const i18nMock = {
  changeLanguage: mock((_lang: string) => {}),
};

mock.module('../../services/api', () => ({
  default: {
    auth: {
      me: () => apiMocks.authMe(),
      switchRole: (roleId: string) => apiMocks.authSwitchRole(roleId),
      logout: () => apiMocks.authLogout(),
    },
    settings: {
      get: () => apiMocks.settingsGet(),
    },
  },
  ApiError: ApiErrorStub,
  getAuthToken: () => getAuthTokenMock(),
  setAuthToken: (token: string | null) => setAuthTokenMock(token),
}));

mock.module('../../i18n', () => ({
  default: i18nMock,
}));

clearSpyStateAfterAll();

const { useAuth } = await import('../../hooks/useAuth');

describe('useAuth', () => {
  beforeEach(() => {
    tokenStore.token = null;
    apiMocks.authMe.mockReset();
    apiMocks.authSwitchRole.mockReset();
    apiMocks.authLogout.mockReset();
    apiMocks.settingsGet.mockReset();
    setAuthTokenMock.mockReset();
    getAuthTokenMock.mockReset();
    i18nMock.changeLanguage.mockReset();

    apiMocks.authMe.mockImplementation(() => Promise.resolve({ id: 'u1' }));
    apiMocks.authSwitchRole.mockImplementation((_roleId: string) =>
      Promise.resolve({ user: { id: 'u2', name: 'switched' }, token: 'new-token' }),
    );
    apiMocks.authLogout.mockImplementation(() => Promise.resolve({ endSessionUrl: null }));
    apiMocks.settingsGet.mockImplementation(() =>
      Promise.resolve({ fullName: 'F', email: 'e@e', language: 'auto' }),
    );
    getAuthTokenMock.mockImplementation(() => tokenStore.token);
    setAuthTokenMock.mockImplementation((token: string | null) => {
      tokenStore.token = token;
    });

    localStorage.clear();
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });
  });

  afterEach(() => {
    localStorage.clear();
  });

  test('initial mount with no stored token leaves user null', async () => {
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.currentUser).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(apiMocks.authMe).not.toHaveBeenCalled();
  });

  test('initial mount with stored token fetches user and applies settings', async () => {
    tokenStore.token = 'stored-token';
    const userObj = { id: 'u-from-token', name: 'me' };
    apiMocks.authMe.mockImplementation(() => Promise.resolve(userObj));
    apiMocks.settingsGet.mockImplementation(() =>
      Promise.resolve({ fullName: 'X', email: 'x@x', language: 'it' }),
    );

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.currentUser).toEqual(userObj as never);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.userSettings.language).toBe('it');
    expect(i18nMock.changeLanguage).toHaveBeenCalledWith('it');
    expect(localStorage.getItem('i18nextLng')).toBe('it');
  });

  test('initial mount: 401 from api.auth.me clears token (token is no longer trustworthy)', async () => {
    tokenStore.token = 'bad-token';
    apiMocks.authMe.mockImplementation(() => Promise.reject(new ApiErrorStub('unauthorized', 401)));

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.currentUser).toBeNull();
    expect(setAuthTokenMock).toHaveBeenCalledWith(null);
    expect(result.current.serverUnreachable).toBe(false);
  });

  test('initial mount: 403 from api.auth.me also clears token', async () => {
    tokenStore.token = 'bad-token';
    apiMocks.authMe.mockImplementation(() => Promise.reject(new ApiErrorStub('forbidden', 403)));

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.currentUser).toBeNull();
    expect(setAuthTokenMock).toHaveBeenCalledWith(null);
  });

  test('initial mount: transient network error retries then recovers (no logout)', async () => {
    tokenStore.token = 'good-token';
    let calls = 0;
    apiMocks.authMe.mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new ApiErrorStub('network down', 0, true));
      }
      return Promise.resolve({ id: 'u-recovered', name: 'me' });
    });

    const { result } = renderHook(() => useAuth({ retryDelaysMs: [0, 0, 0] }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(calls).toBeGreaterThanOrEqual(2);
    expect(result.current.currentUser?.id).toBe('u-recovered');
    expect(setAuthTokenMock).not.toHaveBeenCalled();
    expect(result.current.serverUnreachable).toBe(false);
  });

  test('initial mount: 5xx triggers retries then keeps token + raises banner', async () => {
    tokenStore.token = 'good-token';
    apiMocks.authMe.mockImplementation(() => Promise.reject(new ApiErrorStub('boom', 503)));

    const { result } = renderHook(() => useAuth({ retryDelaysMs: [0, 0, 0] }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // 1 initial + 3 retries = 4 attempts.
    expect(apiMocks.authMe.mock.calls.length).toBe(4);
    expect(setAuthTokenMock).not.toHaveBeenCalled();
    expect(tokenStore.token).toBe('good-token');
    expect(result.current.serverUnreachable).toBe(true);
    expect(result.current.currentUser).toBeNull();
  });

  test('initial mount: transient error exhausts retries → keeps token, sets serverUnreachable', async () => {
    tokenStore.token = 'good-token';
    apiMocks.authMe.mockImplementation(() => Promise.reject(new ApiErrorStub('offline', 0, true)));

    const { result } = renderHook(() => useAuth({ retryDelaysMs: [0, 0] }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(apiMocks.authMe.mock.calls.length).toBe(3); // 1 + 2 retries
    expect(setAuthTokenMock).not.toHaveBeenCalled();
    expect(result.current.serverUnreachable).toBe(true);
  });

  test('dismissServerUnreachable clears the banner state', async () => {
    tokenStore.token = 'good-token';
    apiMocks.authMe.mockImplementation(() => Promise.reject(new ApiErrorStub('offline', 0, true)));

    const { result } = renderHook(() => useAuth({ retryDelaysMs: [0] }));
    await waitFor(() => expect(result.current.serverUnreachable).toBe(true));

    act(() => {
      result.current.dismissServerUnreachable();
    });

    expect(result.current.serverUnreachable).toBe(false);
  });

  test('non-ApiError rejection is treated as transient and does NOT log the user out', async () => {
    tokenStore.token = 'good-token';
    apiMocks.authMe.mockImplementation(() => Promise.reject(new Error('odd shape')));

    const { result } = renderHook(() => useAuth({ retryDelaysMs: [0] }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(setAuthTokenMock).not.toHaveBeenCalled();
    expect(tokenStore.token).toBe('good-token');
    expect(result.current.serverUnreachable).toBe(true);
  });

  test('non-transient 4xx (e.g. 400) does NOT clear the token but raises banner', async () => {
    tokenStore.token = 'good-token';
    apiMocks.authMe.mockImplementation(() => Promise.reject(new ApiErrorStub('bad request', 400)));

    const { result } = renderHook(() => useAuth({ retryDelaysMs: [0, 0, 0] }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // 400 is not retried (only network/5xx) and is not 401/403, so:
    // - no token clearance
    // - no retry storm
    // - banner is raised so something visible surfaces
    expect(apiMocks.authMe.mock.calls.length).toBe(1);
    expect(setAuthTokenMock).not.toHaveBeenCalled();
    expect(result.current.serverUnreachable).toBe(true);
  });

  test('language=auto removes localStorage entry and detects browser language', async () => {
    tokenStore.token = 'tok';
    Object.defineProperty(navigator, 'language', { value: 'it-IT', configurable: true });
    localStorage.setItem('i18nextLng', 'en');
    apiMocks.authMe.mockImplementation(() => Promise.resolve({ id: 'u' }));
    apiMocks.settingsGet.mockImplementation(() =>
      Promise.resolve({ fullName: '', email: '', language: 'auto' }),
    );

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(localStorage.getItem('i18nextLng')).toBeNull();
    expect(i18nMock.changeLanguage).toHaveBeenCalledWith('it');
  });

  test('language=auto with unknown browser language falls back to en', async () => {
    tokenStore.token = 'tok';
    Object.defineProperty(navigator, 'language', { value: 'fr-FR', configurable: true });
    apiMocks.authMe.mockImplementation(() => Promise.resolve({ id: 'u' }));
    apiMocks.settingsGet.mockImplementation(() =>
      Promise.resolve({ fullName: '', email: '', language: 'auto' }),
    );

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(i18nMock.changeLanguage).toHaveBeenCalledWith('en');
  });

  test('login sets token, user, and fires onLogin callback', async () => {
    const onLogin = mock((_u: unknown) => {});
    const { result } = renderHook(() => useAuth({ onLogin }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const user = { id: 'u-login', name: 'login-user' };
    await act(async () => {
      await result.current.login(user as never, 'fresh-token');
    });

    expect(setAuthTokenMock).toHaveBeenCalledWith('fresh-token');
    expect(result.current.currentUser).toEqual(user as never);
    expect(onLogin).toHaveBeenCalledWith(user);
  });

  test('login without token does not call setAuthToken', async () => {
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    setAuthTokenMock.mockReset();

    await act(async () => {
      await result.current.login({ id: 'no-token-user' } as never);
    });

    expect(setAuthTokenMock).not.toHaveBeenCalled();
    expect(result.current.currentUser?.id).toBe('no-token-user');
  });

  test('logout clears token, user, sets logoutReason, fires onLogout', async () => {
    const onLogout = mock((_r: unknown) => {});
    const { result } = renderHook(() => useAuth({ onLogout }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.login({ id: 'u' } as never, 'tok');
    });

    act(() => {
      result.current.logout('inactivity');
    });

    expect(setAuthTokenMock).toHaveBeenLastCalledWith(null);
    expect(result.current.currentUser).toBeNull();
    expect(result.current.logoutReason).toBe('inactivity');
    expect(onLogout).toHaveBeenCalledWith('inactivity');
  });

  // Issue #610: when the server returns an `endSessionUrl` (OIDC RP-Initiated Logout), the
  // hook hands the browser to that URL after clearing local state — otherwise the IdP
  // session cookie stays alive and the next tab silently SSOs back in as the previous user.
  test('logout redirects to endSessionUrl when the server returns one', async () => {
    const originalLocation = window.location;
    const assignMock = mock((_url: string) => {});
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...originalLocation, assign: assignMock },
    });
    apiMocks.authLogout.mockImplementation(() =>
      Promise.resolve({ endSessionUrl: 'https://idp.example.com/logout?id_token_hint=tok' }),
    );

    try {
      const { result } = renderHook(() => useAuth());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        result.current.logout();
        // Microtask flush so the .then() chain in logout fires before the assertion.
        await Promise.resolve();
      });

      await waitFor(() =>
        expect(assignMock).toHaveBeenCalledWith('https://idp.example.com/logout?id_token_hint=tok'),
      );
      // Local clear still happens before the redirect (synchronous) — the user is logged out
      // of Praetor regardless of what the IdP does with the redirect.
      expect(result.current.currentUser).toBeNull();
      expect(setAuthTokenMock).toHaveBeenLastCalledWith(null);
    } finally {
      // Restore the real happy-dom Location object intact. Re-spreading the current
      // (mocked) location would drop its accessor-based `href` getter and leak a
      // location without `href` into later test files (e.g. Login, whose mount effect
      // calls `new URL(window.location.href)`).
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: originalLocation,
      });
    }
  });

  test('logout does NOT redirect when endSessionUrl is null', async () => {
    const originalLocation = window.location;
    const assignMock = mock((_url: string) => {});
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...originalLocation, assign: assignMock },
    });
    apiMocks.authLogout.mockImplementation(() => Promise.resolve({ endSessionUrl: null }));

    try {
      const { result } = renderHook(() => useAuth());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        result.current.logout();
        await Promise.resolve();
      });

      expect(assignMock).not.toHaveBeenCalled();
    } finally {
      // Restore the real happy-dom Location object intact. Re-spreading the current
      // (mocked) location would drop its accessor-based `href` getter and leak a
      // location without `href` into later test files (e.g. Login, whose mount effect
      // calls `new URL(window.location.href)`).
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: originalLocation,
      });
    }
  });

  test('logout without reason sets logoutReason to null', async () => {
    const onLogout = mock((_r: unknown) => {});
    const { result } = renderHook(() => useAuth({ onLogout }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.logout();
    });

    expect(result.current.logoutReason).toBeNull();
    expect(onLogout).toHaveBeenCalledWith(null);
  });

  test('clearLogoutReason resets the reason', async () => {
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.logout('inactivity');
    });
    expect(result.current.logoutReason).toBe('inactivity');

    act(() => {
      result.current.clearLogoutReason();
    });
    expect(result.current.logoutReason).toBeNull();
  });

  test('callback ref-sync effect only re-runs when callback identity changes', async () => {
    // Snapshot the latest callback identity captured by the ref. The effect is
    // what updates the ref, so the ref's value tells us whether the effect ran.
    const onLoginA = mock((_u: unknown) => {});
    const onLoginB = mock((_u: unknown) => {});

    const { result, rerender } = renderHook(
      ({ onLogin }: { onLogin: typeof onLoginA }) => useAuth({ onLogin }),
      { initialProps: { onLogin: onLoginA } },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Re-render with the SAME callback identity. Without the deps array, the
    // effect would fire anyway; with [onLogin, onLogout] it should be a no-op.
    rerender({ onLogin: onLoginA });
    await act(async () => {
      await result.current.login({ id: 'check-a' } as never, 'tok-a');
    });
    expect(onLoginA).toHaveBeenLastCalledWith({ id: 'check-a' });
    expect(onLoginB).not.toHaveBeenCalled();

    // Now swap to a different callback identity - the effect MUST run and
    // update the ref so login fires the new callback.
    rerender({ onLogin: onLoginB });
    await act(async () => {
      await result.current.login({ id: 'check-b' } as never, 'tok-b');
    });
    expect(onLoginB).toHaveBeenLastCalledWith({ id: 'check-b' });
  });

  test('pending retry-sleep timer is cleared on unmount (no leaked setTimeout)', async () => {
    tokenStore.token = 'good-token';
    apiMocks.authMe.mockImplementation(() => Promise.reject(new ApiErrorStub('offline', 0, true)));

    // Pick a delay long enough that the timer cannot naturally fire before we
    // unmount, so a `clearTimeout` call is the only way the timer goes away.
    const SLEEP_MS = 5000;
    const sleepTimerIds = new Set<unknown>();
    const clearedIds: unknown[] = [];
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    // Use plain assignment instead of spyOn so @testing-library doesn't treat
    // setTimeout as a jest-fake-timer mock (which makes waitFor explode).
    globalThis.setTimeout = ((
      cb: (...args: unknown[]) => void,
      ms?: number,
      ...rest: unknown[]
    ) => {
      const id = (realSetTimeout as unknown as (...a: unknown[]) => unknown)(cb, ms, ...rest);
      if (ms === SLEEP_MS) sleepTimerIds.add(id);
      return id;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((id: unknown) => {
      clearedIds.push(id);
      return (realClearTimeout as unknown as (i: unknown) => void)(id);
    }) as unknown as typeof clearTimeout;

    try {
      const { unmount } = renderHook(() => useAuth({ retryDelaysMs: [SLEEP_MS] }));

      // Wait until the retry loop enters sleep() — observable via a setTimeout
      // call with our distinctive delay.
      await waitFor(() => expect(sleepTimerIds.size).toBeGreaterThan(0));

      unmount();

      const cleared = clearedIds.some((id) => sleepTimerIds.has(id));
      expect(cleared).toBe(true);
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }
  });

  test('switchRole calls api and applies returned user/token via login', async () => {
    const onLogin = mock((_u: unknown) => {});
    apiMocks.authSwitchRole.mockImplementation((_roleId: string) =>
      Promise.resolve({ user: { id: 'switched' }, token: 'role-token' }),
    );

    const { result } = renderHook(() => useAuth({ onLogin }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.switchRole('role-mgr');
    });

    expect(apiMocks.authSwitchRole).toHaveBeenCalledWith('role-mgr');
    expect(setAuthTokenMock).toHaveBeenLastCalledWith('role-token');
    expect(result.current.currentUser?.id).toBe('switched');
    expect(onLogin).toHaveBeenCalled();
  });
});
