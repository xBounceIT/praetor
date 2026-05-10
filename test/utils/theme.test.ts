import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  applyTheme,
  getBrowserTheme,
  getTheme,
  THEME_CHANGE_EVENT,
  THEME_MEDIA_QUERY,
  THEME_SCOPE_SELECTOR,
  THEME_STORAGE_KEY,
  THEMES,
  type Theme,
} from '../../utils/theme';

const originalMatchMedia = window.matchMedia;

const setBrowserDarkMode = (matches: boolean) => {
  let listener: ((event: MediaQueryListEvent) => void) | undefined;
  const mediaQuery = {
    matches,
    media: THEME_MEDIA_QUERY,
    onchange: null,
    addEventListener: (_type: string, callback: (event: MediaQueryListEvent) => void) => {
      listener = callback;
    },
    removeEventListener: () => {
      listener = undefined;
    },
    addListener: (callback: (event: MediaQueryListEvent) => void) => {
      listener = callback;
    },
    removeListener: () => {
      listener = undefined;
    },
    dispatchEvent: () => true,
    triggerChange: (nextMatches: boolean) => {
      mediaQuery.matches = nextMatches;
      listener?.({ matches: nextMatches } as MediaQueryListEvent);
    },
  };

  window.matchMedia = (() => mediaQuery as MediaQueryList) as typeof window.matchMedia;
};

const resetRootTheme = () => {
  const root = document.documentElement;
  root.classList.remove('dark');
  root.removeAttribute('data-theme');
  root.removeAttribute('data-shadcn-theme');
  root.style.removeProperty('color-scheme');
  document.querySelectorAll(THEME_SCOPE_SELECTOR).forEach((element) => {
    element.remove();
  });
};

const appendThemeScope = () => {
  const scope = document.createElement('div');
  scope.dataset.shadcnThemeScope = '';
  document.body.append(scope);
  return scope;
};

describe('THEMES constant', () => {
  test('exposes available theme options', () => {
    expect([...THEMES]).toEqual(['light', 'dark', 'zebra', 'praetor', 'auto']);
  });
});

describe('getTheme', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('returns "auto" when nothing is stored', () => {
    expect(getTheme()).toBe('auto');
  });

  test('returns "auto" when stored value is unrecognized', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'unknown-theme');
    expect(getTheme()).toBe('auto');
  });

  test('returns each recognized theme when explicitly stored', () => {
    for (const theme of THEMES) {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
      expect(getTheme()).toBe(theme);
    }
  });

  test('rejects legacy storage values', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'tempo');
    expect(getTheme()).toBe('auto');
  });
});

describe('getBrowserTheme', () => {
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  test('returns dark when the browser dark media query matches', () => {
    setBrowserDarkMode(true);
    expect(getBrowserTheme()).toBe('dark');
  });

  test('returns light when the browser dark media query does not match', () => {
    setBrowserDarkMode(false);
    expect(getBrowserTheme()).toBe('light');
  });
});

describe('applyTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    resetRootTheme();
    setBrowserDarkMode(false);
  });

  afterEach(() => {
    localStorage.clear();
    resetRootTheme();
    window.matchMedia = originalMatchMedia;
  });

  test('writes the chosen theme name to localStorage', () => {
    applyTheme('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  test('applies light mode to shadcn theme scopes only', () => {
    const scope = appendThemeScope();
    applyTheme('light');
    const root = document.documentElement;
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.dataset.theme).toBeUndefined();
    expect(root.style.colorScheme).toBe('');
    expect(scope.classList.contains('dark')).toBe(false);
    expect(scope.dataset.shadcnTheme).toBe('light');
  });

  test('applies dark mode to shadcn theme scopes only', () => {
    const scope = appendThemeScope();
    let eventTheme: string | undefined;
    window.addEventListener(
      THEME_CHANGE_EVENT,
      (event) => {
        eventTheme = (event as CustomEvent<{ resolvedTheme: string }>).detail.resolvedTheme;
      },
      { once: true },
    );

    applyTheme('dark');
    const root = document.documentElement;
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.dataset.theme).toBeUndefined();
    expect(scope.classList.contains('dark')).toBe(true);
    expect(scope.dataset.shadcnTheme).toBe('dark');
    expect(eventTheme).toBe('dark');
  });

  test('applies zebra as light mode with a dedicated theme token', () => {
    const scope = appendThemeScope();
    applyTheme('zebra');

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(scope.classList.contains('dark')).toBe(false);
    expect(scope.dataset.shadcnTheme).toBe('zebra');
  });

  test('applies praetor as light mode with a dedicated theme token', () => {
    const scope = appendThemeScope();
    applyTheme('praetor');

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(scope.classList.contains('dark')).toBe(false);
    expect(scope.dataset.shadcnTheme).toBe('praetor');
  });

  test('auto resolves to the browser theme', () => {
    const scope = appendThemeScope();
    setBrowserDarkMode(true);
    applyTheme('auto');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(scope.classList.contains('dark')).toBe(true);
    expect(scope.dataset.shadcnTheme).toBe('dark');
  });

  test('auto follows browser theme changes after it is applied', () => {
    const scope = appendThemeScope();
    const mediaQuery = window.matchMedia(THEME_MEDIA_QUERY) as MediaQueryList & {
      triggerChange: (nextMatches: boolean) => void;
    };

    applyTheme('auto');
    expect(scope.classList.contains('dark')).toBe(false);

    mediaQuery.triggerChange(true);
    expect(scope.classList.contains('dark')).toBe(true);
  });

  test('switching to a fixed theme stops following browser theme changes', () => {
    const scope = appendThemeScope();
    const mediaQuery = window.matchMedia(THEME_MEDIA_QUERY) as MediaQueryList & {
      triggerChange: (nextMatches: boolean) => void;
    };

    applyTheme('auto');
    applyTheme('light');

    mediaQuery.triggerChange(true);
    expect(scope.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  test('round-trips with getTheme', () => {
    for (const theme of THEMES as readonly Theme[]) {
      applyTheme(theme);
      expect(getTheme()).toBe(theme);
    }
  });
});
