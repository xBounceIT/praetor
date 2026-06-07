import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  getBrowserTheme,
  getResolvedTheme,
  type ResolvedTheme,
  subscribeBrowserTheme,
  THEME_CHANGE_EVENT,
  THEME_SCOPE_SELECTOR,
} from '@/utils/theme';

const RESOLVED_THEMES = new Set<ResolvedTheme>(['light', 'dark', 'zebra', 'praetor']);

const isResolvedTheme = (theme: string | undefined): theme is ResolvedTheme =>
  Boolean(theme && RESOLVED_THEMES.has(theme as ResolvedTheme));

const getActiveScopedTheme = (): ResolvedTheme | undefined => {
  if (typeof document === 'undefined') return undefined;

  const scope = document.querySelector<HTMLElement>(`${THEME_SCOPE_SELECTOR}[data-shadcn-theme]`);
  const scopedTheme = scope?.dataset.shadcnTheme;
  return isResolvedTheme(scopedTheme) ? scopedTheme : undefined;
};

const getCurrentShadcnTheme = () => getActiveScopedTheme() ?? getResolvedTheme();

export const getShadcnThemeClassName = (theme: ResolvedTheme) => {
  return theme === 'dark' ? 'dark' : undefined;
};

// Subscribe to in-app theme changes (dispatched as THEME_CHANGE_EVENT). Returns a no-op
// unsubscribe on the server where there is no window to listen on.
const subscribeShadcnTheme = (onStoreChange: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
};

// The resolved theme is external mutable state (a DOM attribute updated outside React), so read
// it through useSyncExternalStore rather than mirroring it into useState via a mount effect.
export const useResolvedShadcnTheme = (): ResolvedTheme =>
  useSyncExternalStore(subscribeShadcnTheme, getCurrentShadcnTheme, getCurrentShadcnTheme);

/**
 * Track the OS/browser color scheme, ignoring any saved theme preference. Used
 * by the login screen so it follows the OS/browser theme rather than the
 * signed-in user's stored choice.
 */
export const useBrowserTheme = (): ResolvedTheme => {
  const [browserTheme, setBrowserTheme] = useState<ResolvedTheme>(() => getBrowserTheme());

  useEffect(() => {
    return subscribeBrowserTheme(setBrowserTheme);
  }, []);

  return browserTheme;
};
