import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { clearSpyStateAfterAll } from '../helpers/mockCleanup.ts';

// Mock the i18n module BEFORE importing the SUT, so the import binding picks up
// our stub (mirrors the pattern in test/hooks/useAuth.test.ts).
const i18nMock = {
  changeLanguage: mock((_lang: string) => Promise.resolve()),
};

mock.module('../../i18n', () => ({
  default: i18nMock,
}));

clearSpyStateAfterAll();

const { applyLanguagePreference } = await import('../../utils/language');

const STORAGE_KEY = 'i18nextLng';

const setNavigatorLanguage = (lang: string) => {
  Object.defineProperty(globalThis.navigator, 'language', {
    configurable: true,
    value: lang,
  });
};

describe('applyLanguagePreference', () => {
  beforeEach(() => {
    i18nMock.changeLanguage.mockReset();
    i18nMock.changeLanguage.mockImplementation((_lang: string) => Promise.resolve());
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test('does nothing when given undefined', async () => {
    await applyLanguagePreference(undefined);
    expect(i18nMock.changeLanguage).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test('does nothing when given an empty string', async () => {
    await applyLanguagePreference('');
    expect(i18nMock.changeLanguage).not.toHaveBeenCalled();
  });

  test('persists explicit language choice and applies it via i18n', async () => {
    await applyLanguagePreference('it');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('it');
    expect(i18nMock.changeLanguage).toHaveBeenCalledWith('it');
  });

  test('overwrites a previously stored preference', async () => {
    localStorage.setItem(STORAGE_KEY, 'en');
    await applyLanguagePreference('it');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('it');
  });

  test('"auto" clears storage and uses the supported browser language', async () => {
    localStorage.setItem(STORAGE_KEY, 'it');
    setNavigatorLanguage('it-IT');

    await applyLanguagePreference('auto');

    // i18next's localStorage cache (added so explicit selections survive
    // reload) writes back inside changeLanguage. Auto mode must remove it
    // again so the next load re-detects from navigator/querystring.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(i18nMock.changeLanguage).toHaveBeenCalledWith('it');
  });

  test('"auto" falls back to "en" when the browser language is unsupported', async () => {
    setNavigatorLanguage('fr-FR');
    await applyLanguagePreference('auto');
    expect(i18nMock.changeLanguage).toHaveBeenCalledWith('en');
  });

  test('"auto" honors the bare language code without region', async () => {
    setNavigatorLanguage('en');
    await applyLanguagePreference('auto');
    expect(i18nMock.changeLanguage).toHaveBeenCalledWith('en');
  });

  test('arbitrary explicit language strings are passed through without validation', async () => {
    // The SUT only validates browser-derived languages, not user-supplied ones.
    await applyLanguagePreference('zh');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('zh');
    expect(i18nMock.changeLanguage).toHaveBeenCalledWith('zh');
  });

  test('"auto" does not leave the auto-detected language cached', async () => {
    setNavigatorLanguage('en');
    await applyLanguagePreference('auto');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
