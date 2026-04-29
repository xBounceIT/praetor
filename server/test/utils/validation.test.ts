import { describe, expect, test } from 'bun:test';
import { LANGUAGES } from '../../repositories/settingsRepo.ts';
import { optionalEnum } from '../../utils/validation.ts';

describe('optionalEnum', () => {
  test('returns null value for undefined', () => {
    const result = optionalEnum(undefined, LANGUAGES, 'language');
    expect(result).toEqual({ ok: true, value: null });
  });

  test('returns null value for null', () => {
    const result = optionalEnum(null, LANGUAGES, 'language');
    expect(result).toEqual({ ok: true, value: null });
  });

  test('returns null value for empty string', () => {
    const result = optionalEnum('', LANGUAGES, 'language');
    expect(result).toEqual({ ok: true, value: null });
  });

  test('returns the value when input is a valid enum member', () => {
    const result = optionalEnum('en', LANGUAGES, 'language');
    expect(result).toEqual({ ok: true, value: 'en' });
  });

  test('trims whitespace before validating', () => {
    const result = optionalEnum('  it  ', LANGUAGES, 'language');
    expect(result).toEqual({ ok: true, value: 'it' });
  });

  test('rejects values not in the allowed list with a descriptive message', () => {
    const result = optionalEnum('fr', LANGUAGES, 'language');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('language');
      expect(result.message).toContain('en');
      expect(result.message).toContain('it');
      expect(result.message).toContain('auto');
    }
  });

  test('rejects non-string input', () => {
    const result = optionalEnum(42, LANGUAGES, 'language');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('must be a string');
    }
  });
});
