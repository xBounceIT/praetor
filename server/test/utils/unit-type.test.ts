import { describe, expect, test } from 'bun:test';
import { normalizeUnitType, type UnitType } from '../../utils/unit-type.ts';

describe('normalizeUnitType', () => {
  test('returns "days" for the literal "days"', () => {
    expect(normalizeUnitType('days')).toBe('days');
  });

  test('returns "unit" for the literal "unit"', () => {
    expect(normalizeUnitType('unit')).toBe('unit');
  });

  test('returns "hours" for the literal "hours"', () => {
    expect(normalizeUnitType('hours')).toBe('hours');
  });

  test('falls back to "hours" for unknown strings', () => {
    expect(normalizeUnitType('week')).toBe('hours');
    expect(normalizeUnitType('')).toBe('hours');
    expect(normalizeUnitType('DAYS')).toBe('hours'); // case sensitive
  });

  test('falls back to "hours" for nullish input', () => {
    expect(normalizeUnitType(null)).toBe('hours');
    expect(normalizeUnitType(undefined)).toBe('hours');
  });

  test('falls back to "hours" for non-string input', () => {
    expect(normalizeUnitType(0)).toBe('hours');
    expect(normalizeUnitType({})).toBe('hours');
    expect(normalizeUnitType([])).toBe('hours');
    expect(normalizeUnitType(true)).toBe('hours');
  });

  test('return type is assignable to UnitType', () => {
    const value: UnitType = normalizeUnitType('days');
    expect(value).toBe('days');
  });
});
