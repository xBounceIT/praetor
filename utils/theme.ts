export const THEMES = ['light', 'dark', 'zebra', 'praetor', 'auto'] as const;

export type Theme = (typeof THEMES)[number];
export type ResolvedTheme = Exclude<Theme, 'auto'>;

const STORAGE_KEY = 'praetor_theme';
const DARK_MODE_QUERY = '(prefers-color-scheme: dark)';
const SHADCN_THEME_SCOPE_SELECTOR = '[data-shadcn-theme-scope]';
const THEME_CHANGE_EVENT_NAME = 'praetor-theme-change';

export const THEME_STORAGE_KEY = STORAGE_KEY;
export const THEME_MEDIA_QUERY = DARK_MODE_QUERY;
export const THEME_SCOPE_SELECTOR = SHADCN_THEME_SCOPE_SELECTOR;
export const THEME_CHANGE_EVENT = THEME_CHANGE_EVENT_NAME;

let removeAutoThemeListener: (() => void) | undefined;

const isTheme = (value: string | null): value is Theme => {
  return THEMES.includes(value as Theme);
};

export const getTheme = (): Theme => {
  const saved = localStorage.getItem(STORAGE_KEY);
  return isTheme(saved) ? saved : 'auto';
};

export const getBrowserTheme = (): ResolvedTheme => {
  if (typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia(DARK_MODE_QUERY).matches ? 'dark' : 'light';
};

const resolveTheme = (theme: Theme): ResolvedTheme => {
  return theme === 'auto' ? getBrowserTheme() : theme;
};

export const getResolvedTheme = (theme: Theme = getTheme()): ResolvedTheme => {
  return resolveTheme(theme);
};

const clearLegacyRootTheme = () => {
  const root = document.documentElement;
  root.classList.remove('dark');
  root.removeAttribute('data-theme');
  root.style.removeProperty('color-scheme');
};

const applyResolvedTheme = (theme: ResolvedTheme) => {
  clearLegacyRootTheme();
  document.querySelectorAll<HTMLElement>(SHADCN_THEME_SCOPE_SELECTOR).forEach((scope) => {
    scope.classList.toggle('dark', theme === 'dark');
    scope.dataset.shadcnTheme = theme;
  });
  window.dispatchEvent(
    new CustomEvent(THEME_CHANGE_EVENT_NAME, {
      detail: { resolvedTheme: theme },
    }),
  );
};

const unsubscribeAutoTheme = () => {
  removeAutoThemeListener?.();
  removeAutoThemeListener = undefined;
};

const subscribeAutoTheme = () => {
  if (typeof window.matchMedia !== 'function') return;

  const mediaQuery = window.matchMedia(DARK_MODE_QUERY);
  const handleChange = () => applyResolvedTheme(resolveTheme('auto'));

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handleChange);
    removeAutoThemeListener = () => mediaQuery.removeEventListener('change', handleChange);
    return;
  }

  mediaQuery.addListener(handleChange);
  removeAutoThemeListener = () => mediaQuery.removeListener(handleChange);
};

export const applyTheme = (theme: Theme) => {
  unsubscribeAutoTheme();
  applyResolvedTheme(resolveTheme(theme));
  if (theme === 'auto') subscribeAutoTheme();
  localStorage.setItem(STORAGE_KEY, theme);
};
