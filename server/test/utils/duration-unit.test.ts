import { describe, expect, test } from 'bun:test';
import {
  DURATION_UNITS,
  type DurationUnit,
  normalizeDurationUnit,
} from '../../utils/duration-unit.ts';

describe('DURATION_UNITS', () => {
  test('is the ordered allow-list ["months", "years"]', () => {
    expect([...DURATION_UNITS]).toEqual(['months', 'years']);
  });
});

describe('normalizeDurationUnit', () => {
  test('returns "years" for the literal "years"', () => {
    expect(normalizeDurationUnit('years')).toBe('years');
  });

  test('returns "months" for the literal "months"', () => {
    expect(normalizeDurationUnit('months')).toBe('months');
  });

  test('falls back to "months" for nullish input', () => {
    expect(normalizeDurationUnit(undefined)).toBe('months');
    expect(normalizeDurationUnit(null)).toBe('months');
  });

  test('falls back to "months" for unknown / non-string input', () => {
    expect(normalizeDurationUnit('garbage')).toBe('months');
    expect(normalizeDurationUnit('YEARS')).toBe('months'); // case sensitive
    expect(normalizeDurationUnit(0)).toBe('months');
    expect(normalizeDurationUnit({})).toBe('months');
  });

  test('return type is assignable to DurationUnit', () => {
    const value: DurationUnit = normalizeDurationUnit('years');
    expect(value).toBe('years');
  });
});
