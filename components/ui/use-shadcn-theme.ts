import { useEffect, useState } from 'react';
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

export const getCurrentShadcnTheme = () => getActiveScopedTheme() ?? getResolvedTheme();

export const getShadcnThemeClassName = (theme: ResolvedTheme) => {
  return theme === 'dark' ? 'dark' : undefined;
};

export const useResolvedShadcnTheme = () => {
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => getCurrentShadcnTheme());

  useEffect(() => {
    const handleThemeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ resolvedTheme?: ResolvedTheme }>).detail;
      setResolvedTheme(detail?.resolvedTheme ?? getCurrentShadcnTheme());
    };

    setResolvedTheme(getCurrentShadcnTheme());
    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
  }, []);

  return resolvedTheme;
};

/**
 * Track the OS/browser color scheme, ignoring any saved theme preference. Used
 * by the login screen so it follows the OS/browser theme rather than the
 * signed-in user's stored choice.
 */
export const useBrowserTheme = (): ResolvedTheme => {
  const [browserTheme, setBrowserTheme] = useState<ResolvedTheme>(() => getBrowserTheme());

  useEffect(() => {
    setBrowserTheme(getBrowserTheme());
    return subscribeBrowserTheme(setBrowserTheme);
  }, []);

  return browserTheme;
};
