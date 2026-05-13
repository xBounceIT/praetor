import { describe, expect, test } from 'bun:test';
import { numericForDb, parseDbNumber, parseNullableDbNumber } from '../../utils/parse.ts';

describe('parseDbNumber', () => {
  test('parses string numerics', () => {
    expect(parseDbNumber('10.5', 0)).toBe(10.5);
  });

  test('returns fallback for null/undefined', () => {
    expect(parseDbNumber(null, 0)).toBe(0);
    expect(parseDbNumber(undefined, 0)).toBe(0);
  });

  test('returns fallback for non-finite values', () => {
    expect(parseDbNumber('abc', 0)).toBe(0);
    expect(parseDbNumber(Number.NaN, 0)).toBe(0);
  });
});

describe('parseNullableDbNumber', () => {
  test('returns null for null/undefined', () => {
    expect(parseNullableDbNumber(null)).toBeNull();
    expect(parseNullableDbNumber(undefined)).toBeNull();
  });

  test('parses string and number numerics', () => {
    expect(parseNullableDbNumber('10.5')).toBe(10.5);
    expect(parseNullableDbNumber(7)).toBe(7);
  });

  test('returns null for non-finite input rather than coercing to 0', () => {
    expect(parseNullableDbNumber('abc')).toBeNull();
    expect(parseNullableDbNumber('')).toBeNull();
    expect(parseNullableDbNumber(Number.NaN)).toBeNull();
    expect(parseNullableDbNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('numericForDb', () => {
  test('passes null and undefined through unchanged', () => {
    expect(numericForDb(null)).toBeNull();
    expect(numericForDb(undefined)).toBeUndefined();
  });

  test('formats common integers and decimals as plain strings', () => {
    expect(numericForDb(0)).toBe('0');
    expect(numericForDb(5)).toBe('5');
    expect(numericForDb(12.5)).toBe('12.5');
    expect(numericForDb(-3.25)).toBe('-3.25');
  });

  test('formats very large numbers without scientific notation', () => {
    // `String(1e21)` would yield '1e+21' which PostgreSQL's NUMERIC parser rejects.
    expect(numericForDb(1e21)).toBe('1000000000000000000000');
  });

  test('formats very small numbers without scientific notation', () => {
    // `String(1e-7)` would yield '1e-7'.
    expect(numericForDb(1e-7)).toBe('0.0000001');
  });

  test('passes plain-decimal strings through unchanged (preserves precision)', () => {
    expect(numericForDb('123.45')).toBe('123.45');
    // Critical for currency: '0.10' must stay '0.10', not be re-parsed to '0.1'.
    expect(numericForDb('0.10')).toBe('0.10');
    expect(numericForDb('-100.00')).toBe('-100.00');
  });

  test('trims whitespace around plain-decimal strings', () => {
    expect(numericForDb('  42.5  ')).toBe('42.5');
  });

  test('rejects strings that are not plain-decimal literals', () => {
    expect(() => numericForDb('abc')).toThrow();
    expect(() => numericForDb('1e10')).toThrow();
    expect(() => numericForDb('1,5')).toThrow();
    expect(() => numericForDb('')).toThrow();
    expect(() => numericForDb('+5')).toThrow();
    expect(() => numericForDb('5.')).toThrow();
  });

  test('rejects NaN and Infinity', () => {
    expect(() => numericForDb(Number.NaN)).toThrow();
    expect(() => numericForDb(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => numericForDb(Number.NEGATIVE_INFINITY)).toThrow();
  });
});
