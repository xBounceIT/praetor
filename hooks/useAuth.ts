import { useCallback, useEffect, useRef, useState } from 'react';
import api, { ApiError, getAuthToken, type Settings, setAuthToken } from '../services/api';
import type { LogoutNotice, User } from '../types';
import { applyLanguagePreference } from '../utils/language';
import { isTransientError, RETRY_DELAYS_MS } from '../utils/retry';

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
  const [logoutReason, setLogoutReason] = useState<LogoutNotice | null>(null);
  const [userSettings, setUserSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [serverUnreachable, setServerUnreachable] = useState(false);

  const onLoginRef = useRef(opts.onLogin);
  const onLogoutRef = useRef(opts.onLogout);
  const logoutAttemptRef = useRef(0);
  const logoutStartedRef = useRef(false);
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
    let cancelPendingRetry: (() => void) | null = null;
    const delays = retryDelaysRef.current;
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const finish = () => {
          cancelPendingRetry = null;
          resolve();
        };
        const timer = setTimeout(finish, ms);
        cancelPendingRetry = () => {
          clearTimeout(timer);
          finish();
        };
      });
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
      cancelPendingRetry?.();
    };
  }, [loadUserSettings]);

  const login = useCallback(
    async (user: User, token?: string) => {
      // Invalidate any slow response from an earlier logout. It must not redirect or surface
      // a stale warning after the user has already established a new session.
      logoutAttemptRef.current += 1;
      logoutStartedRef.current = false;
      setLogoutReason(null);
      if (token) setAuthToken(token);
      // Run the consumer's reset BEFORE flipping currentUser so any effects keyed on
      // currentUser see the cleaned auth-scoped state in the same render batch - otherwise
      // a login or role-switch can briefly resurface the previous session's data.
      onLoginRef.current?.(user);
      // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- Async login callback queues state after external cleanup; it is not an updater function.
      setCurrentUser(user);
      await loadUserSettings();
    },
    [loadUserSettings],
  );

  const logout = useCallback((reason?: 'inactivity') => {
    // The first request still carries the session token; a duplicate would be unauthenticated
    // after the synchronous local clear and must not supersede the authoritative attempt.
    if (logoutStartedRef.current) return;
    logoutStartedRef.current = true;

    // Local state clears immediately so the user is logged out of Praetor regardless of
    // server reachability. If the server returns an IdP end-session URL we additionally
    // hand the browser to it, so the IdP's session cookie dies alongside our JWT.
    const logoutAttempt = ++logoutAttemptRef.current;
    api.auth
      .logout()
      .then((res) => {
        if (logoutAttemptRef.current === logoutAttempt && res?.endSessionUrl) {
          window.location.assign(res.endSessionUrl);
        }
      })
      .catch((err) => {
        console.error(
          'Server logout failed; server-side and external identity-provider sessions may still be active:',
          err,
        );
        if (logoutAttemptRef.current === logoutAttempt) {
          // A failed authenticated response may have rotated and re-persisted the JWT before
          // the API client threw. Clear it again without erasing a newer login's token.
          setAuthToken(null);
          setLogoutReason('logout-incomplete');
        }
      });
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
