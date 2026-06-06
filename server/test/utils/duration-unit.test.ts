import { describe, expect, test } from 'bun:test';
import {
  coerceUnitLineDuration,
  DURATION_UNITS,
  type DurationUnit,
  isUnitMeasure,
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

describe('isUnitMeasure', () => {
  test('is true only for the literal "unit"', () => {
    expect(isUnitMeasure('unit')).toBe(true);
    expect(isUnitMeasure('hours')).toBe(false);
    expect(isUnitMeasure('days')).toBe(false);
    expect(isUnitMeasure(null)).toBe(false);
    expect(isUnitMeasure(undefined)).toBe(false);
  });
});

describe('coerceUnitLineDuration', () => {
  test('forces a unit-measured line to a single month', () => {
    expect(coerceUnitLineDuration(true, 12, 'years')).toEqual({
      durationMonths: 1,
      durationUnit: 'months',
    });
  });

  test('leaves a non-unit line untouched', () => {
    expect(coerceUnitLineDuration(false, 12, 'years')).toEqual({
      durationMonths: 12,
      durationUnit: 'years',
    });
    expect(coerceUnitLineDuration(false, 3, 'months')).toEqual({
      durationMonths: 3,
      durationUnit: 'months',
    });
  });
});
