import { describe, expect, test } from 'bun:test';
import { normalizeNullableNumber, normalizeNullableString } from '../../utils/normalize.ts';

describe('normalizeNullableString', () => {
  test('returns null for null/undefined', () => {
    expect(normalizeNullableString(null)).toBeNull();
    expect(normalizeNullableString(undefined)).toBeNull();
  });

  test('trims surrounding whitespace', () => {
    expect(normalizeNullableString('  sqi-1  ')).toBe('sqi-1');
    expect(normalizeNullableString('plain')).toBe('plain');
  });

  test('collapses empty and whitespace-only strings to null', () => {
    expect(normalizeNullableString('')).toBeNull();
    expect(normalizeNullableString('   ')).toBeNull();
    expect(normalizeNullableString('\t\n ')).toBeNull();
  });

  test('coerces non-string primitives to a trimmed string', () => {
    expect(normalizeNullableString(42)).toBe('42');
    expect(normalizeNullableString(0)).toBe('0');
    expect(normalizeNullableString(false)).toBe('false');
  });
});

describe('normalizeNullableNumber', () => {
  test('returns null for null/undefined', () => {
    expect(normalizeNullableNumber(null)).toBeNull();
    expect(normalizeNullableNumber(undefined)).toBeNull();
  });

  test('passes numbers through, including zero', () => {
    expect(normalizeNullableNumber(12.5)).toBe(12.5);
    expect(normalizeNullableNumber(0)).toBe(0);
  });

  test('coerces numeric strings', () => {
    expect(normalizeNullableNumber('7.25')).toBe(7.25);
  });
});
