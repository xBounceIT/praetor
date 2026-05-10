import { useEffect, useState } from 'react';
import { getResolvedTheme, type ResolvedTheme, THEME_CHANGE_EVENT } from '@/utils/theme';

export const getShadcnThemeClassName = (theme: ResolvedTheme) => {
  return theme === 'dark' ? 'dark' : undefined;
};

export const useResolvedShadcnTheme = () => {
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => getResolvedTheme());

  useEffect(() => {
    const handleThemeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ resolvedTheme?: ResolvedTheme }>).detail;
      setResolvedTheme(detail?.resolvedTheme ?? getResolvedTheme());
    };

    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
  }, []);

  return resolvedTheme;
};
