import { useCallback, useEffect, useRef, useState } from 'react';
import api, { getAuthToken, type Settings, setAuthToken } from '../services/api';
import { type ApiError, isApiError } from '../services/api/client';
import type { User } from '../types';
import { applyLanguagePreference } from '../utils/language';

const DEFAULT_SETTINGS: Settings = {
  fullName: '',
  email: '',
  language: 'auto',
};

const CACHED_USER_STORAGE_KEY = 'praetor_cached_auth_user';

const readCachedUser = (): User | null => {
  try {
    const raw = localStorage.getItem(CACHED_USER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as User;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeCachedUser = (user: User | null) => {
  try {
    if (user) {
      localStorage.setItem(CACHED_USER_STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(CACHED_USER_STORAGE_KEY);
    }
  } catch {
    // Storage may be full or unavailable (private mode). Cache is best-effort.
  }
};

// 401/403 = real auth failure (clear the token). Anything else (network blip,
// 5xx, parse failures) is treated as transient so we don't log the user out on
// a flaky connection.
const isAuthFailure = (err: unknown): err is ApiError =>
  isApiError(err) && (err.statusCode === 401 || err.statusCode === 403);

export type UseAuthOptions = {
  onLogin?: (user: User) => void;
  onLogout?: (reason: 'inactivity' | null) => void;
};

export function useAuth(opts: UseAuthOptions = {}) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [logoutReason, setLogoutReason] = useState<'inactivity' | null>(null);
  const [userSettings, setUserSettings] = useState<Settings>(DEFAULT_SETTINGS);

  const onLoginRef = useRef(opts.onLogin);
  const onLogoutRef = useRef(opts.onLogout);
  useEffect(() => {
    onLoginRef.current = opts.onLogin;
    onLogoutRef.current = opts.onLogout;
  });

  const loadUserSettings = useCallback(async () => {
    try {
      const settings = await api.settings.get();
      setUserSettings(settings);
      applyLanguagePreference(settings.language);
    } catch {
      // Settings may not exist yet for a fresh user - non-fatal.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const checkAuth = async () => {
      const token = getAuthToken();
      if (token) {
        try {
          const user = await api.auth.me();
          if (cancelled) return;
          setCurrentUser(user);
          writeCachedUser(user);
          await loadUserSettings();
        } catch (err) {
          if (cancelled) return;
          if (isAuthFailure(err)) {
            // Server explicitly rejected the token - clear it and any cache.
            setAuthToken(null);
            writeCachedUser(null);
          } else {
            // Transient (network/5xx). Keep the token; restore the previously
            // cached user so the UI stays usable until the next successful
            // request rotates the token or surfaces a real auth failure.
            const cached = readCachedUser();
            if (cached) setCurrentUser(cached);
          }
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
      writeCachedUser(user);
      await loadUserSettings();
    },
    [loadUserSettings],
  );

  const logout = useCallback((reason?: 'inactivity') => {
    setAuthToken(null);
    setCurrentUser(null);
    writeCachedUser(null);
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
  };
}
