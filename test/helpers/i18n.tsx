import { mock } from 'bun:test';
import type { ReactNode } from 'react';

/**
 * Installs an identity-translator mock for react-i18next.
 * Test assertions check translation keys, not translations.
 * Call once at the top of a test file before importing components.
 */
export const installI18nMock = (options?: { includeInterpolatedValues?: boolean }) => {
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, values?: Record<string, unknown>) => {
        if (options?.includeInterpolatedValues && values && 'value' in values) {
          return `${key} (${String(values.value)})`;
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: () => {} },
    }),
    Trans: ({ children }: { children: ReactNode }) => children,
    initReactI18next: { type: '3rdParty', init: () => {} },
  }));
};
