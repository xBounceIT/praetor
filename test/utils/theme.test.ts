import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { applyTheme, getTheme, THEMES, type Theme } from '../../utils/theme';

const STORAGE_KEY = 'praetor_theme';

describe('THEMES constant', () => {
  test('exposes both "default" and "tempo" themes', () => {
    expect(Object.keys(THEMES).sort()).toEqual(['default', 'tempo']);
  });

  test('every theme defines --color-primary and --color-primary-hover', () => {
    for (const theme of Object.keys(THEMES) as Theme[]) {
      expect(THEMES[theme]['--color-primary']).toBeDefined();
      expect(THEMES[theme]['--color-primary-hover']).toBeDefined();
    }
  });
});

describe('getTheme', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('returns "default" when nothing is stored', () => {
    expect(getTheme()).toBe('default');
  });

  test('returns "default" when stored value is unrecognized', () => {
    localStorage.setItem(STORAGE_KEY, 'unknown-theme');
    expect(getTheme()).toBe('default');
  });

  test('returns "tempo" when explicitly stored', () => {
    localStorage.setItem(STORAGE_KEY, 'tempo');
    expect(getTheme()).toBe('tempo');
  });

  test('returns "default" when explicitly stored', () => {
    localStorage.setItem(STORAGE_KEY, 'default');
    expect(getTheme()).toBe('default');
  });

  test('rejects empty-string storage value', () => {
    localStorage.setItem(STORAGE_KEY, '');
    expect(getTheme()).toBe('default');
  });
});

describe('applyTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    // Clear inline CSS variables that any prior test (or default styles) may have set.
    const root = document.documentElement;
    root.style.removeProperty('--color-primary');
    root.style.removeProperty('--color-primary-hover');
  });

  afterEach(() => {
    localStorage.clear();
    const root = document.documentElement;
    root.style.removeProperty('--color-primary');
    root.style.removeProperty('--color-primary-hover');
  });

  test('writes the chosen theme name to localStorage', () => {
    applyTheme('tempo');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('tempo');
  });

  test('writes "default" theme name to localStorage', () => {
    applyTheme('default');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('default');
  });

  test('sets the documented CSS custom properties for the "default" theme', () => {
    applyTheme('default');
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--color-primary')).toBe(THEMES.default['--color-primary']);
    expect(root.style.getPropertyValue('--color-primary-hover')).toBe(
      THEMES.default['--color-primary-hover'],
    );
  });

  test('sets the documented CSS custom properties for the "tempo" theme', () => {
    applyTheme('tempo');
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--color-primary')).toBe(THEMES.tempo['--color-primary']);
    expect(root.style.getPropertyValue('--color-primary-hover')).toBe(
      THEMES.tempo['--color-primary-hover'],
    );
  });

  test('switching themes overwrites the previously applied custom properties', () => {
    applyTheme('default');
    applyTheme('tempo');
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--color-primary')).toBe(THEMES.tempo['--color-primary']);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('tempo');
  });

  test('round-trips with getTheme', () => {
    applyTheme('tempo');
    expect(getTheme()).toBe('tempo');
    applyTheme('default');
    expect(getTheme()).toBe('default');
  });
});
