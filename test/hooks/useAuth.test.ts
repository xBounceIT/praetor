import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';

const apiMocks = {
  authMe: mock((): Promise<unknown> => Promise.resolve({ id: 'u1' })),
  authSwitchRole: mock(
    (_roleId: string): Promise<unknown> => Promise.resolve({ user: { id: 'u1' }, token: 't1' }),
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
    },
    settings: {
      get: () => apiMocks.settingsGet(),
    },
  },
  getAuthToken: () => getAuthTokenMock(),
  setAuthToken: (token: string | null) => setAuthTokenMock(token),
}));

mock.module('../../i18n', () => ({
  default: i18nMock,
}));

const { useAuth } = await import('../../hooks/useAuth');

describe('useAuth', () => {
  beforeEach(() => {
    tokenStore.token = null;
    apiMocks.authMe.mockReset();
    apiMocks.authSwitchRole.mockReset();
    apiMocks.settingsGet.mockReset();
    setAuthTokenMock.mockReset();
    getAuthTokenMock.mockReset();
    i18nMock.changeLanguage.mockReset();

    apiMocks.authMe.mockImplementation(() => Promise.resolve({ id: 'u1' }));
    apiMocks.authSwitchRole.mockImplementation((_roleId: string) =>
      Promise.resolve({ user: { id: 'u2', name: 'switched' }, token: 'new-token' }),
    );
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

  test('initial mount: api.auth.me rejection clears token', async () => {
    tokenStore.token = 'bad-token';
    apiMocks.authMe.mockImplementation(() => Promise.reject(new Error('bad token')));

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.currentUser).toBeNull();
    expect(setAuthTokenMock).toHaveBeenCalledWith(null);
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
