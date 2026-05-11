import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

describe('i18n language persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test('reads the stored language from localStorage on init', async () => {
    localStorage.setItem('i18nextLng', 'en');

    // Re-import to force a fresh init. We intentionally bust the module cache
    // by appending a query string supported by Bun's loader.
    const i18nModule = await import(`../../i18n?t=${Date.now()}`);
    const i18n = i18nModule.default;

    expect(i18n.language).toBe('en');
  });

  test('persists language changes back to localStorage', async () => {
    localStorage.setItem('i18nextLng', 'en');
    const i18nModule = await import(`../../i18n?t=${Date.now()}`);
    const i18n = i18nModule.default;

    await i18n.changeLanguage('it');

    expect(localStorage.getItem('i18nextLng')).toBe('it');
    expect(i18n.language).toBe('it');
  });

  test('detection config includes localStorage caching', async () => {
    const i18nModule = await import(`../../i18n?t=${Date.now()}`);
    const i18n = i18nModule.default;

    const detectionOptions = i18n.options.detection as {
      caches?: string[];
      order?: string[];
    };

    expect(detectionOptions.caches).toContain('localStorage');
    expect(detectionOptions.order).toContain('localStorage');
  });
});
