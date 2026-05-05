import { mock } from 'bun:test';
import type { ReactNode } from 'react';

/**
 * Installs an identity-translator mock for react-i18next.
 * Test assertions check translation keys, not translations.
 * Call once at the top of a test file before importing components.
 */
export const installI18nMock = () => {
  mock.module('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: 'en', changeLanguage: () => {} },
    }),
    Trans: ({ children }: { children: ReactNode }) => children,
    initReactI18next: { type: '3rdParty', init: () => {} },
  }));
};
