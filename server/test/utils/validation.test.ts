import { describe, expect, mock, test } from 'bun:test';
import * as settingsRepo from '../../repositories/settingsRepo.ts';
import {
  badRequest,
  ensureArrayOfStrings,
  isNonEmptyString,
  isValidEmail,
  isWeekendDate,
  optionalArrayOfStrings,
  optionalBoolean,
  optionalDateString,
  optionalDurationMonths,
  optionalDurationUnit,
  optionalEmail,
  optionalEnum,
  optionalLocalizedNonNegativeNumber,
  optionalLocalizedNumber,
  optionalLocalizedPositiveNumber,
  optionalNonEmptyString,
  optionalNonNegativeNumber,
  optionalNumber,
  optionalPositiveNumber,
  parseBoolean,
  parseBooleanField,
  parseBooleanStrict,
  parseDateString,
  parseLocalizedNonNegativeNumber,
  parseLocalizedNumber,
  parseLocalizedPositiveNumber,
  parseNonNegativeNumber,
  parseNumber,
  parseOptionalStringFields,
  parsePositiveNumber,
  parseQueryBoolean,
  requireNonEmptyArrayOfStrings,
  requireNonEmptyString,
  requireNonEmptyStringRaw,
  validateClientIdentifier,
  validateEmail,
  validateEnum,
} from '../../utils/validation.ts';

describe('isNonEmptyString', () => {
  test('accepts a non-empty string and trims it', () => {
    expect(isNonEmptyString('  hello  ')).toEqual({ ok: true, value: 'hello' });
  });

  test('rejects an empty string', () => {
    const result = isNonEmptyString('');
    expect(result.ok).toBe(false);
  });

  test('rejects whitespace-only string', () => {
    const result = isNonEmptyString('   ');
    expect(result.ok).toBe(false);
  });

  test('rejects non-string values', () => {
    expect(isNonEmptyString(42).ok).toBe(false);
    expect(isNonEmptyString(null).ok).toBe(false);
    expect(isNonEmptyString(undefined).ok).toBe(false);
    expect(isNonEmptyString({}).ok).toBe(false);
    expect(isNonEmptyString([]).ok).toBe(false);
  });
});

describe('requireNonEmptyString', () => {
  test('accepts a valid non-empty string and trims it', () => {
    expect(requireNonEmptyString('  abc  ', 'name')).toEqual({ ok: true, value: 'abc' });
  });

  test('returns required-message for missing values', () => {
    const result = requireNonEmptyString(undefined, 'name');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('name is required');
  });

  test('returns required-message for empty string', () => {
    const result = requireNonEmptyString('', 'email');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('email is required');
  });

  test('returns required-message for whitespace-only string', () => {
    const result = requireNonEmptyString('   ', 'title');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('title is required');
  });
});

describe('requireNonEmptyStringRaw', () => {
  test('accepts a valid non-empty string and preserves surrounding whitespace', () => {
    expect(requireNonEmptyStringRaw('  abc  ', 'password')).toEqual({
      ok: true,
      value: '  abc  ',
    });
  });

  test('returns required-message for whitespace-only string', () => {
    const result = requireNonEmptyStringRaw('   ', 'password');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('password is required');
  });
});

describe('optionalNonEmptyString', () => {
  test('returns null for undefined/null/empty', () => {
    expect(optionalNonEmptyString(undefined, 'phone')).toEqual({ ok: true, value: null });
    expect(optionalNonEmptyString(null, 'phone')).toEqual({ ok: true, value: null });
    expect(optionalNonEmptyString('', 'phone')).toEqual({ ok: true, value: null });
  });

  test('returns trimmed value for valid input', () => {
    expect(optionalNonEmptyString('  hi  ', 'phone')).toEqual({ ok: true, value: 'hi' });
  });

  test('rejects invalid (whitespace-only) string', () => {
    const result = optionalNonEmptyString('   ', 'phone');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('phone');
  });

  test('rejects non-string when provided', () => {
    const result = optionalNonEmptyString(42, 'phone');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('phone');
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

  test('rejects whitespace-only strings as invalid (not coerced to null)', () => {
    const result = parseOptionalStringFields({ phone: '   ' }, ['phone'] as const);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe('phone');
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

describe('parseNumber', () => {
  test('accepts a number', () => {
    expect(parseNumber(42)).toEqual({ ok: true, value: 42 });
  });

  test('accepts a numeric string', () => {
    expect(parseNumber('3.14')).toEqual({ ok: true, value: 3.14 });
  });

  test('rejects non-finite number', () => {
    expect(parseNumber(NaN).ok).toBe(false);
    expect(parseNumber(Infinity).ok).toBe(false);
    expect(parseNumber(-Infinity).ok).toBe(false);
  });

  test('rejects strings that parse to non-finite values', () => {
    expect(parseNumber('Infinity').ok).toBe(false);
    expect(parseNumber('-Infinity').ok).toBe(false);
    expect(parseNumber('1e999').ok).toBe(false);
    expect(parseNumber('-1e999').ok).toBe(false);
  });

  test('rejects empty trimmed string', () => {
    const result = parseNumber('   ', 'qty');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('qty cannot be an empty string');
  });

  test('rejects non-numeric string', () => {
    const result = parseNumber('abc', 'qty');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('valid number');
  });

  test('rejects boolean and object', () => {
    expect(parseNumber(true).ok).toBe(false);
    expect(parseNumber({}).ok).toBe(false);
  });

  test('uses default fieldName "value"', () => {
    const result = parseNumber('abc');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('value');
  });
});

describe('parseLocalizedNumber', () => {
  test('accepts a finite number', () => {
    expect(parseLocalizedNumber(2.5)).toEqual({ ok: true, value: 2.5 });
  });

  test('rejects non-finite number', () => {
    expect(parseLocalizedNumber(Infinity).ok).toBe(false);
    expect(parseLocalizedNumber(NaN).ok).toBe(false);
  });

  test('accepts a comma-decimal string', () => {
    expect(parseLocalizedNumber('3,14')).toEqual({ ok: true, value: 3.14 });
  });

  test('accepts a dot-decimal string', () => {
    expect(parseLocalizedNumber('3.14')).toEqual({ ok: true, value: 3.14 });
  });

  test('rejects empty trimmed string', () => {
    const result = parseLocalizedNumber('   ', 'amount');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('amount cannot be an empty string');
  });

  test('rejects strings without digits', () => {
    const result = parseLocalizedNumber('.', 'amount');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('valid number');
  });

  test('rejects strings with invalid characters', () => {
    const result = parseLocalizedNumber('1.2.3', 'amount');
    expect(result.ok).toBe(false);
  });

  test('rejects non-string non-number', () => {
    expect(parseLocalizedNumber(true).ok).toBe(false);
    expect(parseLocalizedNumber(null).ok).toBe(false);
  });
});

describe('optionalLocalizedNumber', () => {
  test('returns null for undefined/null/empty', () => {
    expect(optionalLocalizedNumber(undefined)).toEqual({ ok: true, value: null });
    expect(optionalLocalizedNumber(null)).toEqual({ ok: true, value: null });
    expect(optionalLocalizedNumber('')).toEqual({ ok: true, value: null });
  });

  test('returns parsed value', () => {
    expect(optionalLocalizedNumber('5,5')).toEqual({ ok: true, value: 5.5 });
  });

  test('forwards parse error message', () => {
    const result = optionalLocalizedNumber('xyz', 'amount');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('amount');
  });
});

describe('optionalNumber', () => {
  test('returns null for undefined/null/empty', () => {
    expect(optionalNumber(undefined)).toEqual({ ok: true, value: null });
    expect(optionalNumber(null)).toEqual({ ok: true, value: null });
    expect(optionalNumber('')).toEqual({ ok: true, value: null });
  });

  test('returns parsed value', () => {
    expect(optionalNumber('7')).toEqual({ ok: true, value: 7 });
  });

  test('forwards parse error message', () => {
    const result = optionalNumber('abc', 'qty');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('qty');
  });
});

describe('parseNonNegativeNumber', () => {
  test('accepts zero', () => {
    expect(parseNonNegativeNumber(0)).toEqual({ ok: true, value: 0 });
  });

  test('accepts positive numbers', () => {
    expect(parseNonNegativeNumber(5)).toEqual({ ok: true, value: 5 });
  });

  test('rejects negatives', () => {
    const result = parseNonNegativeNumber(-1, 'qty');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('qty must be zero or positive');
  });

  test('forwards parseNumber error', () => {
    const result = parseNonNegativeNumber('abc', 'qty');
    expect(result.ok).toBe(false);
  });
});

describe('parseLocalizedNonNegativeNumber', () => {
  test('accepts zero', () => {
    expect(parseLocalizedNonNegativeNumber(0)).toEqual({ ok: true, value: 0 });
  });

  test('rejects negatives', () => {
    const result = parseLocalizedNonNegativeNumber(-2, 'amount');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('zero or positive');
  });

  test('forwards parse error', () => {
    const result = parseLocalizedNonNegativeNumber('not-a-number', 'amount');
    expect(result.ok).toBe(false);
  });
});

describe('optionalNonNegativeNumber', () => {
  test('returns null for empty', () => {
    expect(optionalNonNegativeNumber('')).toEqual({ ok: true, value: null });
    expect(optionalNonNegativeNumber(null)).toEqual({ ok: true, value: null });
    expect(optionalNonNegativeNumber(undefined)).toEqual({ ok: true, value: null });
  });

  test('returns parsed', () => {
    expect(optionalNonNegativeNumber(0)).toEqual({ ok: true, value: 0 });
  });

  test('forwards error', () => {
    const result = optionalNonNegativeNumber(-1, 'qty');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('qty');
  });
});

describe('optionalLocalizedNonNegativeNumber', () => {
  test('returns null for empty', () => {
    expect(optionalLocalizedNonNegativeNumber('')).toEqual({ ok: true, value: null });
    expect(optionalLocalizedNonNegativeNumber(null)).toEqual({ ok: true, value: null });
    expect(optionalLocalizedNonNegativeNumber(undefined)).toEqual({ ok: true, value: null });
  });

  test('parses comma-decimals', () => {
    expect(optionalLocalizedNonNegativeNumber('1,5')).toEqual({ ok: true, value: 1.5 });
  });

  test('forwards error', () => {
    const result = optionalLocalizedNonNegativeNumber(-3, 'amount');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('amount');
  });
});

describe('parsePositiveNumber', () => {
  test('accepts strictly positive', () => {
    expect(parsePositiveNumber(1)).toEqual({ ok: true, value: 1 });
  });

  test('rejects zero', () => {
    const result = parsePositiveNumber(0, 'qty');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe('qty must be greater than zero');
  });

  test('rejects negatives', () => {
    const result = parsePositiveNumber(-2, 'qty');
    expect(result.ok).toBe(false);
  });

  test('forwards parseNumber error', () => {
    const result = parsePositiveNumber('foo', 'qty');
    expect(result.ok).toBe(false);
  });
});

describe('parseLocalizedPositiveNumber', () => {
  test('accepts strictly positive', () => {
    expect(parseLocalizedPositiveNumber('2,5')).toEqual({ ok: true, value: 2.5 });
  });

  test('rejects zero', () => {
    const result = parseLocalizedPositiveNumber(0, 'amount');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('greater than zero');
  });

  test('forwards error', () => {
    const result = parseLocalizedPositiveNumber('xyz', 'amount');
    expect(result.ok).toBe(false);
  });
});

describe('optionalPositiveNumber', () => {
  test('returns null for empty', () => {
    expect(optionalPositiveNumber('')).toEqual({ ok: true, value: null });
    expect(optionalPositiveNumber(null)).toEqual({ ok: true, value: null });
    expect(optionalPositiveNumber(undefined)).toEqual({ ok: true, value: null });
  });

  test('returns parsed', () => {
    expect(optionalPositiveNumber(2)).toEqual({ ok: true, value: 2 });
  });

  test('forwards error', () => {
    const result = optionalPositiveNumber(0, 'qty');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('qty');
  });
});

describe('optionalLocalizedPositiveNumber', () => {
  test('returns null for empty', () => {
    expect(optionalLocalizedPositiveNumber('')).toEqual({ ok: true, value: null });
    expect(optionalLocalizedPositiveNumber(null)).toEqual({ ok: true, value: null });
    expect(optionalLocalizedPositiveNumber(undefined)).toEqual({ ok: true, value: null });
  });

  test('returns parsed', () => {
    expect(optionalLocalizedPositiveNumber('1,5')).toEqual({ ok: true, value: 1.5 });
  });

  test('forwards error', () => {
    const result = optionalLocalizedPositiveNumber(0, 'amount');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('amount');
  });
});

describe('optionalDurationMonths', () => {
  test('absent/empty → null (caller defaults to 1)', () => {
    expect(optionalDurationMonths('')).toEqual({ ok: true, value: null });
    expect(optionalDurationMonths(null)).toEqual({ ok: true, value: null });
    expect(optionalDurationMonths(undefined)).toEqual({ ok: true, value: null });
  });

  test('accepts a positive whole number of months', () => {
    expect(optionalDurationMonths(12)).toEqual({ ok: true, value: 12 });
    expect(optionalDurationMonths('3')).toEqual({ ok: true, value: 3 });
  });

  test('rejects a fractional duration with a whole-months message', () => {
    const result = optionalDurationMonths(2.5, 'items[0].durationMonths');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('whole number of months');
  });

  test('rejects zero or negative durations (must be positive)', () => {
    expect(optionalDurationMonths(0).ok).toBe(false);
    expect(optionalDurationMonths(-3).ok).toBe(false);
  });
});

describe('optionalDurationUnit', () => {
  test('absent/empty → null (caller defaults to "months")', () => {
    expect(optionalDurationUnit('')).toEqual({ ok: true, value: null });
    expect(optionalDurationUnit(null)).toEqual({ ok: true, value: null });
    expect(optionalDurationUnit(undefined)).toEqual({ ok: true, value: null });
  });

  test('accepts the allowed units months/years', () => {
    expect(optionalDurationUnit('months')).toEqual({ ok: true, value: 'months' });
    expect(optionalDurationUnit('years')).toEqual({ ok: true, value: 'years' });
  });

  test('rejects an unknown unit', () => {
    const result = optionalDurationUnit('weeks', 'items[0].durationUnit');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('items[0].durationUnit');
  });
});

describe('parseBoolean', () => {
  test('returns boolean as-is', () => {
    expect(parseBoolean(true)).toBe(true);
    expect(parseBoolean(false)).toBe(false);
  });

  test('returns true for recognized truthy strings (case-insensitive, trimmed)', () => {
    expect(parseBoolean('true')).toBe(true);
    expect(parseBoolean('  TRUE ')).toBe(true);
    expect(parseBoolean('True')).toBe(true);
    expect(parseBoolean('1')).toBe(true);
    expect(parseBoolean('yes')).toBe(true);
    expect(parseBoolean('YES')).toBe(true);
  });

  test('returns false for recognized falsy strings (case-insensitive, trimmed)', () => {
    expect(parseBoolean('false')).toBe(false);
    expect(parseBoolean('FALSE')).toBe(false);
    expect(parseBoolean('0')).toBe(false);
    expect(parseBoolean('no')).toBe(false);
    expect(parseBoolean('NO')).toBe(false);
  });

  test('returns false for unrecognized strings', () => {
    expect(parseBoolean('xyz')).toBe(false);
    expect(parseBoolean('')).toBe(false);
    expect(parseBoolean('off')).toBe(false);
    expect(parseBoolean('on')).toBe(false);
  });

  test('returns false for non-string non-boolean values (no truthiness coercion)', () => {
    expect(parseBoolean(1)).toBe(false);
    expect(parseBoolean(0)).toBe(false);
    expect(parseBoolean({})).toBe(false);
    expect(parseBoolean([])).toBe(false);
    expect(parseBoolean(null)).toBe(false);
    expect(parseBoolean(undefined)).toBe(false);
  });
});

describe('parseBooleanStrict', () => {
  test('accepts booleans and recognized strings', () => {
    expect(parseBooleanStrict(true, 'enabled')).toEqual({ ok: true, value: true });
    expect(parseBooleanStrict(false, 'enabled')).toEqual({ ok: true, value: false });
    expect(parseBooleanStrict(' YES ', 'enabled')).toEqual({ ok: true, value: true });
    expect(parseBooleanStrict('0', 'enabled')).toEqual({ ok: true, value: false });
  });

  test('rejects invalid, null, undefined, and non-string inputs', () => {
    for (const value of ['ture', '', 'off', null, undefined, 1, {}, []]) {
      const result = parseBooleanStrict(value, 'enabled');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain('enabled');
        expect(result.message).toContain('true, false, 1, 0, yes, no');
      }
    }
  });
});

describe('parseBooleanField', () => {
  test('returns undefined for missing fields and parses present values', () => {
    expect(parseBooleanField({}, 'enabled')).toEqual({ ok: true, value: undefined });
    expect(parseBooleanField({ enabled: 'true' }, 'enabled')).toEqual({
      ok: true,
      value: true,
    });
    expect(parseBooleanField({ enabled: false }, 'enabled')).toEqual({
      ok: true,
      value: false,
    });
  });

  test('rejects present null, undefined, and invalid strings', () => {
    for (const source of [{ enabled: null }, { enabled: undefined }, { enabled: 'ture' }]) {
      const result = parseBooleanField(source, 'enabled');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain('enabled');
    }
  });
});

describe('optionalBoolean', () => {
  test('returns null for undefined/null/empty', () => {
    expect(optionalBoolean(undefined)).toBeNull();
    expect(optionalBoolean(null)).toBeNull();
    expect(optionalBoolean('')).toBeNull();
  });

  test('returns parsed boolean', () => {
    expect(optionalBoolean('true')).toBe(true);
    expect(optionalBoolean(false)).toBe(false);
    expect(optionalBoolean('1')).toBe(true);
    expect(optionalBoolean('no')).toBe(false);
  });

  test('returns false for unrecognized non-empty input (lenient parseBoolean)', () => {
    expect(optionalBoolean(1)).toBe(false);
    expect(optionalBoolean('maybe')).toBe(false);
  });
});

describe('parseDateString', () => {
  test('accepts a valid YYYY-MM-DD date', () => {
    expect(parseDateString('2026-05-07')).toEqual({ ok: true, value: '2026-05-07' });
  });

  test('rejects non-string', () => {
    const result = parseDateString(20260507, 'date');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('date');
  });

  test('rejects malformed format', () => {
    const result = parseDateString('05/07/2026', 'date');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('YYYY-MM-DD');
  });

  test('rejects invalid date (e.g. 2026-13-40)', () => {
    const result = parseDateString('2026-13-40', 'date');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('valid date');
  });

  test('rejects Feb 29 in non-leap year (silent JS rollover)', () => {
    const result = parseDateString('2023-02-29', 'date');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('valid date');
  });

  test('rejects month 13', () => {
    const result = parseDateString('2025-13-01', 'date');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('valid date');
  });

  test('rejects April 31 (impossible day for month)', () => {
    const result = parseDateString('2024-04-31', 'date');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('valid date');
  });

  test('accepts Feb 29 in a leap year', () => {
    expect(parseDateString('2024-02-29')).toEqual({ ok: true, value: '2024-02-29' });
  });

  test('accepts Feb 28 in a non-leap year', () => {
    expect(parseDateString('2023-02-28')).toEqual({ ok: true, value: '2023-02-28' });
  });
});

describe('optionalDateString', () => {
  test('returns null for empty inputs', () => {
    expect(optionalDateString(undefined, 'date')).toEqual({ ok: true, value: null });
    expect(optionalDateString(null, 'date')).toEqual({ ok: true, value: null });
    expect(optionalDateString('', 'date')).toEqual({ ok: true, value: null });
  });

  test('returns parsed date', () => {
    expect(optionalDateString('2026-01-01', 'date')).toEqual({ ok: true, value: '2026-01-01' });
  });

  test('forwards error', () => {
    const result = optionalDateString('not-a-date', 'date');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('date');
  });
});

describe('validateEnum', () => {
  test('accepts an allowed value', () => {
    expect(validateEnum('en', settingsRepo.LANGUAGES, 'lang')).toEqual({ ok: true, value: 'en' });
  });

  test('rejects non-string', () => {
    const result = validateEnum(123, settingsRepo.LANGUAGES, 'lang');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('must be a string');
  });

  test('rejects empty trimmed string', () => {
    const result = validateEnum('   ', settingsRepo.LANGUAGES, 'lang');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('cannot be empty');
  });

  test('rejects unknown enum value with helpful list', () => {
    const result = validateEnum('fr', settingsRepo.LANGUAGES, 'lang');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('en, it, auto');
  });

  test('uses default fieldName', () => {
    const result = validateEnum(123, settingsRepo.LANGUAGES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('value');
  });
});

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

describe('ensureArrayOfStrings', () => {
  test('accepts valid array of strings and trims', () => {
    expect(ensureArrayOfStrings([' a ', 'b'], 'tags')).toEqual({ ok: true, value: ['a', 'b'] });
  });

  test('rejects non-array', () => {
    const result = ensureArrayOfStrings('a,b', 'tags');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('must be an array');
  });

  test('rejects array with non-string item', () => {
    const result = ensureArrayOfStrings(['a', 42], 'tags');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('tags[1]');
  });

  test('rejects array with empty string item', () => {
    const result = ensureArrayOfStrings(['a', '   '], 'tags');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('tags[1]');
  });

  test('accepts empty array', () => {
    expect(ensureArrayOfStrings([], 'tags')).toEqual({ ok: true, value: [] });
  });
});

describe('optionalArrayOfStrings', () => {
  test('returns null for undefined/null', () => {
    expect(optionalArrayOfStrings(undefined, 'tags')).toEqual({ ok: true, value: null });
    expect(optionalArrayOfStrings(null, 'tags')).toEqual({ ok: true, value: null });
  });

  test('returns parsed array', () => {
    expect(optionalArrayOfStrings(['a'], 'tags')).toEqual({ ok: true, value: ['a'] });
  });

  test('forwards error', () => {
    const result = optionalArrayOfStrings('nope', 'tags');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('tags');
  });
});

describe('requireNonEmptyArrayOfStrings', () => {
  test('accepts a non-empty array', () => {
    expect(requireNonEmptyArrayOfStrings(['a'], 'tags')).toEqual({ ok: true, value: ['a'] });
  });

  test('rejects non-array', () => {
    const result = requireNonEmptyArrayOfStrings('foo', 'tags');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('must be an array');
  });

  test('rejects empty array', () => {
    const result = requireNonEmptyArrayOfStrings([], 'tags');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('at least one item');
  });

  test('forwards element-validation error', () => {
    const result = requireNonEmptyArrayOfStrings(['a', 1], 'tags');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('tags[1]');
  });
});

describe('parseQueryBoolean', () => {
  test('returns null for missing values', () => {
    expect(parseQueryBoolean(undefined)).toBeNull();
    expect(parseQueryBoolean(null)).toBeNull();
    expect(parseQueryBoolean('')).toBeNull();
  });

  test('returns true for "true"', () => {
    expect(parseQueryBoolean('true')).toBe(true);
    expect(parseQueryBoolean('  TRUE ')).toBe(true);
  });

  test('returns false for "false"', () => {
    expect(parseQueryBoolean('false')).toBe(false);
    expect(parseQueryBoolean('  False ')).toBe(false);
  });

  test('returns null for unknown strings', () => {
    expect(parseQueryBoolean('yes')).toBeNull();
    expect(parseQueryBoolean('1')).toBeNull();
  });

  test('coerces non-strings', () => {
    expect(parseQueryBoolean(true)).toBe(true);
    expect(parseQueryBoolean(false)).toBe(false);
  });
});

describe('badRequest', () => {
  test('sends a 400 with the supplied error message', () => {
    const sendMock = mock((payload: unknown) => payload);
    const codeMock = mock(() => ({ send: sendMock }));
    const reply = { code: codeMock } as unknown as Parameters<typeof badRequest>[0];

    badRequest(reply, 'bad input');

    expect(codeMock).toHaveBeenCalledWith(400);
    expect(sendMock).toHaveBeenCalledWith({ error: 'bad input' });
  });
});

describe('isValidEmail', () => {
  test('accepts a typical email', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
  });

  test('rejects emails with leading/trailing whitespace', () => {
    expect(isValidEmail(' user@example.com')).toBe(false);
    expect(isValidEmail('user@example.com ')).toBe(false);
  });

  test('rejects empty/whitespace-containing', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('a b@example.com')).toBe(false);
  });

  test('rejects missing @, multiple @, or empty parts', () => {
    expect(isValidEmail('userexample.com')).toBe(false);
    expect(isValidEmail('user@@example.com')).toBe(false);
    expect(isValidEmail('@example.com')).toBe(false);
    expect(isValidEmail('user@')).toBe(false);
  });

  test('rejects local part starting/ending with dot or with consecutive dots', () => {
    expect(isValidEmail('.user@example.com')).toBe(false);
    expect(isValidEmail('user.@example.com')).toBe(false);
    expect(isValidEmail('us..er@example.com')).toBe(false);
  });

  test('rejects domain without dot or with consecutive dots', () => {
    expect(isValidEmail('user@example')).toBe(false);
    expect(isValidEmail('user@exa..mple.com')).toBe(false);
  });

  test('rejects empty domain labels or hyphens at edges', () => {
    expect(isValidEmail('user@.example.com')).toBe(false);
    expect(isValidEmail('user@example.com.')).toBe(false);
    expect(isValidEmail('user@-example.com')).toBe(false);
    expect(isValidEmail('user@example-.com')).toBe(false);
  });

  test('rejects TLDs shorter than 2 chars', () => {
    expect(isValidEmail('a@b.c')).toBe(false);
    expect(isValidEmail('user@example.x')).toBe(false);
  });

  test('rejects local-part with only dots / consecutive dots starting at @', () => {
    expect(isValidEmail('..@example.com')).toBe(false);
    expect(isValidEmail('a..b@example.com')).toBe(false);
  });

  test('rejects TLDs with digits', () => {
    expect(isValidEmail('user@example.c0m')).toBe(false);
    expect(isValidEmail('user@example.123')).toBe(false);
  });

  test('rejects non-string input', () => {
    expect(isValidEmail(null as unknown as string)).toBe(false);
    expect(isValidEmail(42 as unknown as string)).toBe(false);
  });

  test('accepts emails with longer TLDs and subdomains', () => {
    expect(isValidEmail('user@mail.example.museum')).toBe(true);
    expect(isValidEmail('first.last+tag@sub.example.com')).toBe(true);
  });
});

describe('validateEmail', () => {
  test('accepts a valid email', () => {
    expect(validateEmail('user@example.com')).toEqual({ ok: true, value: 'user@example.com' });
  });

  test('rejects non-string with default field name', () => {
    const result = validateEmail(123);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('email');
  });

  test('rejects empty string with custom field name', () => {
    const result = validateEmail('', 'contactEmail');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('contactEmail');
  });

  test('rejects invalid format', () => {
    const result = validateEmail('not-an-email');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('valid email');
  });
});

describe('optionalEmail', () => {
  test('returns null for empty inputs', () => {
    expect(optionalEmail(undefined)).toEqual({ ok: true, value: null });
    expect(optionalEmail(null)).toEqual({ ok: true, value: null });
    expect(optionalEmail('')).toEqual({ ok: true, value: null });
  });

  test('returns the validated email', () => {
    expect(optionalEmail('user@example.com')).toEqual({ ok: true, value: 'user@example.com' });
  });

  test('forwards validation error', () => {
    const result = optionalEmail('bad', 'contactEmail');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('contactEmail');
  });
});

describe('validateClientIdentifier', () => {
  test('accepts alphanumeric ids with - and _', () => {
    expect(validateClientIdentifier('abc-123_XYZ')).toEqual({
      ok: true,
      value: 'abc-123_XYZ',
    });
  });

  test('rejects non-string', () => {
    const result = validateClientIdentifier(42);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('id');
  });

  test('rejects ids with disallowed characters', () => {
    const result = validateClientIdentifier('abc 123', 'clientId');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('clientId');
  });

  test('rejects ids containing punctuation', () => {
    const result = validateClientIdentifier('abc@123');
    expect(result.ok).toBe(false);
  });
});

describe('isWeekendDate', () => {
  test('returns true for Saturday', () => {
    // 2026-05-09 is Saturday
    expect(isWeekendDate('2026-05-09')).toBe(true);
  });

  test('returns true for Sunday', () => {
    // 2026-05-10 is Sunday
    expect(isWeekendDate('2026-05-10')).toBe(true);
  });

  test('returns false for weekdays', () => {
    // 2026-05-07 is Thursday
    expect(isWeekendDate('2026-05-07')).toBe(false);
    // 2026-05-04 is Monday
    expect(isWeekendDate('2026-05-04')).toBe(false);
  });
});
