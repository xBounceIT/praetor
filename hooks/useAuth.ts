import { useCallback, useEffect, useRef, useState } from 'react';
import api, { getAuthToken, type Settings, setAuthToken } from '../services/api';
import type { User } from '../types';
import { applyLanguagePreference } from '../utils/language';

const DEFAULT_SETTINGS: Settings = {
  fullName: '',
  email: '',
  language: 'auto',
};

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
      // Settings may not exist yet for a fresh user — non-fatal.
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
          await loadUserSettings();
        } catch {
          if (cancelled) return;
          setAuthToken(null);
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
      // currentUser see the cleaned auth-scoped state in the same render batch — otherwise
      // a login or role-switch can briefly resurface the previous session's data.
      onLoginRef.current?.(user);
      setCurrentUser(user);
      await loadUserSettings();
    },
    [loadUserSettings],
  );

  const logout = useCallback((reason?: 'inactivity') => {
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
  };
}
