import { describe, expect, test } from 'bun:test';
import { parseDbNumber, parseNullableDbNumber } from '../../utils/parse.ts';

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
