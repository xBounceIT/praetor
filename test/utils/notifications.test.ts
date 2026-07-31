import { describe, expect, test } from 'bun:test';
import { formatOvertimeHours } from '../../utils/notifications';

describe('formatOvertimeHours', () => {
  test('formats whole hours without decimals, matching the server message', () => {
    expect(formatOvertimeHours(8)).toBe('8');
    expect(formatOvertimeHours(9)).toBe('9');
  });

  test('formats fractional hours with two decimals, matching the server message', () => {
    expect(formatOvertimeHours(8.5)).toBe('8.50');
    expect(formatOvertimeHours(8.25)).toBe('8.25');
  });

  test('coerces string JSONB values from legacy or hand-edited rows', () => {
    expect(formatOvertimeHours('8')).toBe('8');
    expect(formatOvertimeHours('8.5')).toBe('8.50');
    expect(formatOvertimeHours('8.25')).toBe('8.25');
    expect(formatOvertimeHours('0')).toBe('0');
  });

  test('formats zero hours so a 0h overtime notification is not hidden', () => {
    expect(formatOvertimeHours(0)).toBe('0');
  });

  test('returns an empty string for null, undefined, NaN, and non-numeric values', () => {
    expect(formatOvertimeHours(null)).toBe('');
    expect(formatOvertimeHours(undefined)).toBe('');
    expect(formatOvertimeHours(Number.NaN)).toBe('');
    expect(formatOvertimeHours('not-a-number')).toBe('');
    expect(formatOvertimeHours({})).toBe('');
  });
});
