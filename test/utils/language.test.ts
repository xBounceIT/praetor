import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// Mock the i18n module BEFORE importing the SUT, so the import binding picks up
// our stub (mirrors the pattern in test/hooks/useAuth.test.ts).
const i18nMock = {
  changeLanguage: mock((_lang: string) => {}),
};

mock.module('../../i18n', () => ({
  default: i18nMock,
}));

const { applyLanguagePreference } = await import('../../utils/language');

const setNavigatorLanguage = (lang: string) => {
  Object.defineProperty(globalThis.navigator, 'language', {
    configurable: true,
    value: lang,
  });
};

describe('applyLanguagePreference', () => {
  beforeEach(() => {
    i18nMock.changeLanguage.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test('does nothing when given undefined', () => {
    applyLanguagePreference(undefined);
    expect(i18nMock.changeLanguage).not.toHaveBeenCalled();
    expect(localStorage.getItem('i18nextLng')).toBeNull();
  });

  test('does nothing when given an empty string', () => {
    applyLanguagePreference('');
    expect(i18nMock.changeLanguage).not.toHaveBeenCalled();
  });

  test('persists explicit language choice and applies it via i18n', () => {
    applyLanguagePreference('it');
    expect(localStorage.getItem('i18nextLng')).toBe('it');
    expect(i18nMock.changeLanguage).toHaveBeenCalledWith('it');
  });

  test('overwrites a previously stored preference', () => {
    localStorage.setItem('i18nextLng', 'en');
    applyLanguagePreference('it');
    expect(localStorage.getItem('i18nextLng')).toBe('it');
  });

  test('"auto" clears storage and uses the supported browser language', () => {
    localStorage.setItem('i18nextLng', 'it');
    setNavigatorLanguage('it-IT');

    applyLanguagePreference('auto');

    expect(localStorage.getItem('i18nextLng')).toBeNull();
    expect(i18nMock.changeLanguage).toHaveBeenCalledWith('it');
  });

  test('"auto" falls back to "en" when the browser language is unsupported', () => {
    setNavigatorLanguage('fr-FR');
    applyLanguagePreference('auto');
    expect(i18nMock.changeLanguage).toHaveBeenCalledWith('en');
  });

  test('"auto" honors the bare language code without region', () => {
    setNavigatorLanguage('en');
    applyLanguagePreference('auto');
    expect(i18nMock.changeLanguage).toHaveBeenCalledWith('en');
  });

  test('arbitrary explicit language strings are passed through without validation', () => {
    // The SUT only validates browser-derived languages, not user-supplied ones.
    applyLanguagePreference('zh');
    expect(localStorage.getItem('i18nextLng')).toBe('zh');
    expect(i18nMock.changeLanguage).toHaveBeenCalledWith('zh');
  });
});
