import { describe, expect, test } from 'bun:test';
import {
  DURATION_UNITS,
  type DurationUnit,
  effectiveDurationMonths,
  normalizeDurationUnit,
} from '../../utils/duration-unit.ts';

describe('DURATION_UNITS', () => {
  test('is the ordered allow-list ["months", "years", "na"]', () => {
    expect([...DURATION_UNITS]).toEqual(['months', 'years', 'na']);
  });
});

describe('normalizeDurationUnit', () => {
  test('returns "years" for the literal "years"', () => {
    expect(normalizeDurationUnit('years')).toBe('years');
  });

  test('returns "months" for the literal "months"', () => {
    expect(normalizeDurationUnit('months')).toBe('months');
  });

  test('returns "na" for the literal "na" (issue #775)', () => {
    expect(normalizeDurationUnit('na')).toBe('na');
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

describe('effectiveDurationMonths', () => {
  test('returns the stored months for months/years units', () => {
    expect(effectiveDurationMonths('months', 6)).toBe(6);
    expect(effectiveDurationMonths('years', 24)).toBe(24);
  });

  test("returns 1 for an 'na' unit regardless of the stored months (issue #775)", () => {
    expect(effectiveDurationMonths('na', 6)).toBe(1);
    expect(effectiveDurationMonths('na', 24)).toBe(1);
  });

  test('falls back to 1 for absent, zero, negative, or non-finite months', () => {
    expect(effectiveDurationMonths('months', undefined)).toBe(1);
    expect(effectiveDurationMonths('months', 0)).toBe(1);
    expect(effectiveDurationMonths('months', -3)).toBe(1);
    expect(effectiveDurationMonths('months', Number.NaN)).toBe(1);
  });
});
