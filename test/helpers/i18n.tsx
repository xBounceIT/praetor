import { mock } from 'bun:test';
import type { ReactNode } from 'react';

/**
 * Installs an identity-translator mock for react-i18next.
 * Test assertions check translation keys, not translations.
 * Call once at the top of a test file before importing components.
 */
export const installI18nMock = (options?: { includeInterpolatedValues?: boolean }) => {
  // Keep `t` and `i18n` stable across renders. react-i18next returns a stable
  // `t`, and components rely on that (e.g. useCallback/useEffect deps that include
  // `t`); a fresh `t` per render would spuriously refire those effects in tests.
  const t = (key: string, values?: Record<string, unknown>) => {
    if (options?.includeInterpolatedValues && values && 'value' in values) {
      return `${key} (${String(values.value)})`;
    }
    return key;
  };
  const i18n = { language: 'en', changeLanguage: () => {} };

  mock.module('react-i18next', () => ({
    useTranslation: () => ({ t, i18n }),
    Trans: ({ children }: { children: ReactNode }) => children,
    initReactI18next: { type: '3rdParty', init: () => {} },
  }));
};
