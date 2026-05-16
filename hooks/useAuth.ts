import { useCallback, useEffect, useRef, useState } from 'react';
import api, { ApiError, getAuthToken, type Settings, setAuthToken } from '../services/api';
import type { User } from '../types';
import { applyLanguagePreference } from '../utils/language';
import { isTransientError, RETRY_DELAYS_MS, sleep } from '../utils/retry';

const DEFAULT_SETTINGS: Settings = {
  fullName: '',
  email: '',
  language: 'auto',
};

export const AUTH_CHECK_RETRY_DELAYS_MS = RETRY_DELAYS_MS;

const isAuthRejection = (err: unknown): boolean =>
  err instanceof ApiError && (err.status === 401 || err.status === 403);

export type UseAuthOptions = {
  onLogin?: (user: User) => void;
  onLogout?: (reason: 'inactivity' | null) => void;
  retryDelaysMs?: number[];
};

export function useAuth(opts: UseAuthOptions = {}) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [logoutReason, setLogoutReason] = useState<'inactivity' | null>(null);
  const [userSettings, setUserSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [serverUnreachable, setServerUnreachable] = useState(false);

  const onLoginRef = useRef(opts.onLogin);
  const onLogoutRef = useRef(opts.onLogout);
  const retryDelaysRef = useRef(opts.retryDelaysMs ?? AUTH_CHECK_RETRY_DELAYS_MS);
  // Tie the ref-sync effect to the callback identities so we don't burn a
  // commit re-running it after every parent render. Consumers that pass stable
  // (memoized) callbacks now pay this cost zero extra times.
  useEffect(() => {
    onLoginRef.current = opts.onLogin;
    onLogoutRef.current = opts.onLogout;
  }, [opts.onLogin, opts.onLogout]);

  const loadUserSettings = useCallback(async () => {
    try {
      const settings = await api.settings.get();
      setUserSettings(settings);
      applyLanguagePreference(settings.language);
    } catch {
      // Settings may not exist yet for a fresh user - non-fatal.
    }
  }, []);

  const dismissServerUnreachable = useCallback(() => {
    setServerUnreachable(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const delays = retryDelaysRef.current;
    const checkAuth = async () => {
      const token = getAuthToken();
      if (!token) {
        if (!cancelled) setIsLoading(false);
        return;
      }

      // Retry transient failures so a flaky boot doesn't log the user out;
      // 401/403 clears the token because it's no longer trustworthy.
      let attempt = 0;
      while (!cancelled) {
        try {
          const user = await api.auth.me();
          if (cancelled) return;
          setCurrentUser(user);
          setServerUnreachable(false);
          await loadUserSettings();
          break;
        } catch (err) {
          if (cancelled) return;
          if (isAuthRejection(err)) {
            setAuthToken(null);
            setServerUnreachable(false);
            break;
          }
          if (!isTransientError(err) || attempt >= delays.length) {
            console.error('Initial auth check failed:', err);
            setServerUnreachable(true);
            break;
          }
          await sleep(delays[attempt]);
          attempt += 1;
        }
      }

      if (!cancelled) setIsLoading(false);
    };
    checkAuth();
    return () => {
      cancelled = true;
    };
  }, [loadUserSettings]);

  const login = useCallback(
    async (user: User, token?: string) => {
      if (token) setAuthToken(token);
      // Run the consumer's reset BEFORE flipping currentUser so any effects keyed on
      // currentUser see the cleaned auth-scoped state in the same render batch - otherwise
      // a login or role-switch can briefly resurface the previous session's data.
      onLoginRef.current?.(user);
      setCurrentUser(user);
      await loadUserSettings();
    },
    [loadUserSettings],
  );

  const logout = useCallback((reason?: 'inactivity') => {
    // Best-effort: clear local state regardless of server reachability.
    api.auth.logout().catch(() => {});
    setAuthToken(null);
    setCurrentUser(null);
    const finalReason = reason ?? null;
    setLogoutReason(finalReason);
    onLogoutRef.current?.(finalReason);
  }, []);

  const clearLogoutReason = useCallback(() => {
    setLogoutReason(null);
  }, []);

  const switchRole = useCallback(
    async (roleId: string) => {
      const response = await api.auth.switchRole(roleId);
      await login(response.user, response.token);
    },
    [login],
  );

  return {
    currentUser,
    setCurrentUser,
    isAuthenticated: currentUser !== null,
    isLoading,
    logoutReason,
    clearLogoutReason,
    userSettings,
    setUserSettings,
    login,
    logout,
    switchRole,
    serverUnreachable,
    dismissServerUnreachable,
  };
}
