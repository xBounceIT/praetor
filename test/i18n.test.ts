import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

// Importing the configured i18n instance triggers init().
const i18n = (await import('../i18n')).default;

const STORAGE_KEY = 'i18nextLng';

describe('i18n configuration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test('language detection includes localStorage and uses the i18nextLng key', () => {
    const detection = i18n.options.detection as {
      order: string[];
      caches: string[];
      lookupLocalStorage?: string;
    };

    expect(detection.order).toContain('localStorage');
    expect(detection.caches).toContain('localStorage');
    // i18next defaults lookupLocalStorage to 'i18nextLng' when unset, which is what utils/language.ts writes.
    expect(detection.lookupLocalStorage ?? STORAGE_KEY).toBe(STORAGE_KEY);
  });

  test('changeLanguage caches the language to localStorage', async () => {
    await i18n.changeLanguage('it');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('it');

    await i18n.changeLanguage('en');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('en');
  });
});
