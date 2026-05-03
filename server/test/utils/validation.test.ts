import { describe, expect, test } from 'bun:test';
import * as settingsRepo from '../../repositories/settingsRepo.ts';
import { optionalEnum, parseOptionalStringFields } from '../../utils/validation.ts';

describe('optionalEnum', () => {
  test('returns null value for undefined', () => {
    const result = optionalEnum(undefined, settingsRepo.LANGUAGES, 'language');
    expect(result).toEqual({ ok: true, value: null });
  });

  test('returns null value for null', () => {
    const result = optionalEnum(null, settingsRepo.LANGUAGES, 'language');
    expect(result).toEqual({ ok: true, value: null });
  });

  test('returns null value for empty string', () => {
    const result = optionalEnum('', settingsRepo.LANGUAGES, 'language');
    expect(result).toEqual({ ok: true, value: null });
  });

  test('returns the value when input is a valid enum member', () => {
    const result = optionalEnum('en', settingsRepo.LANGUAGES, 'language');
    expect(result).toEqual({ ok: true, value: 'en' });
  });

  test('trims whitespace before validating', () => {
    const result = optionalEnum('  it  ', settingsRepo.LANGUAGES, 'language');
    expect(result).toEqual({ ok: true, value: 'it' });
  });

  test('rejects values not in the allowed list with a descriptive message', () => {
    const result = optionalEnum('fr', settingsRepo.LANGUAGES, 'language');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('language');
      expect(result.message).toContain('en');
      expect(result.message).toContain('it');
      expect(result.message).toContain('auto');
    }
  });

  test('rejects non-string input', () => {
    const result = optionalEnum(42, settingsRepo.LANGUAGES, 'language');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('must be a string');
    }
  });
});

describe('parseOptionalStringFields', () => {
  test('returns empty values when no listed fields are present on body', () => {
    const result = parseOptionalStringFields({}, ['phone', 'address'] as const);
    expect(result).toEqual({ ok: true, values: {} });
  });

  test('omits absent fields and validates only the present ones', () => {
    const result = parseOptionalStringFields({ phone: '  555  ' }, ['phone', 'address'] as const);
    expect(result).toEqual({ ok: true, values: { phone: '555' } });
  });

  test('preserves explicit null and empty-string as null in values', () => {
    const result = parseOptionalStringFields({ phone: null, address: '' }, [
      'phone',
      'address',
    ] as const);
    expect(result).toEqual({ ok: true, values: { phone: null, address: null } });
  });

  test('uses Object.hasOwn so prototype-inherited fields are ignored', () => {
    const proto = { phone: '555' };
    const body = Object.create(proto) as Record<string, unknown>;
    const result = parseOptionalStringFields(body, ['phone'] as const);
    expect(result).toEqual({ ok: true, values: {} });
  });

  test('returns ok:false with the failing field name and message', () => {
    const result = parseOptionalStringFields({ phone: 42 }, ['phone', 'address'] as const);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe('phone');
      expect(result.message).toContain('phone');
    }
  });

  test('short-circuits on first failure and does not validate later fields', () => {
    const result = parseOptionalStringFields({ phone: 42, address: 99 }, [
      'phone',
      'address',
    ] as const);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe('phone');
    }
  });
});
