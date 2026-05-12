import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { applyLanguagePreference } from '../../utils/language';

const STORAGE_KEY = 'i18nextLng';

describe('applyLanguagePreference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test('explicit language persists to localStorage', async () => {
    await applyLanguagePreference('it');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('it');
  });

  test('auto mode strips any previously cached language', async () => {
    localStorage.setItem(STORAGE_KEY, 'it');
    await applyLanguagePreference('auto');
    // i18next's localStorage cache (added so explicit selections survive
    // reload) writes back inside changeLanguage. Auto mode must remove it
    // again so the next load re-detects from navigator/querystring.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test('auto mode does not leave the auto-detected language cached', async () => {
    await applyLanguagePreference('auto');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test('undefined input is a no-op', async () => {
    localStorage.setItem(STORAGE_KEY, 'it');
    await applyLanguagePreference(undefined);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('it');
  });
});
