import { describe, expect, test } from 'bun:test';
import {
  formatLocalDateOnly,
  isPastLocalDate,
  normalizeNullableDateOnly,
  requireDateOnly,
  todayLocalDateOnly,
} from '../../utils/date.ts';

describe('formatLocalDateOnly', () => {
  test('formats a date as YYYY-MM-DD using local components', () => {
    expect(formatLocalDateOnly(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  test('zero-pads single-digit month and day', () => {
    expect(formatLocalDateOnly(new Date(2026, 8, 5))).toBe('2026-09-05');
  });

  test('handles end-of-year correctly', () => {
    expect(formatLocalDateOnly(new Date(2025, 11, 31))).toBe('2025-12-31');
  });

  test('handles leap day correctly', () => {
    expect(formatLocalDateOnly(new Date(2024, 1, 29))).toBe('2024-02-29');
  });
});

describe('normalizeNullableDateOnly', () => {
  test('returns null for null input', () => {
    expect(normalizeNullableDateOnly(null, 'startDate')).toBeNull();
  });

  test('returns null for undefined input', () => {
    expect(normalizeNullableDateOnly(undefined, 'startDate')).toBeNull();
  });

  test('formats a Date instance via local components', () => {
    expect(normalizeNullableDateOnly(new Date(2026, 4, 15), 'startDate')).toBe('2026-05-15');
  });

  test('strips a time component from an ISO string', () => {
    expect(normalizeNullableDateOnly('2026-05-15T10:30:00Z', 'startDate')).toBe('2026-05-15');
  });

  test('passes a plain YYYY-MM-DD string through unchanged', () => {
    expect(normalizeNullableDateOnly('2026-05-15', 'startDate')).toBe('2026-05-15');
  });

  test('throws TypeError with field name for unsupported types', () => {
    expect(() => normalizeNullableDateOnly(42, 'startDate')).toThrow(
      /Invalid date value for startDate/,
    );
  });
});

describe('requireDateOnly', () => {
  test('returns the normalized value when present', () => {
    expect(requireDateOnly('2026-05-15T10:30:00Z', 'startDate')).toBe('2026-05-15');
  });

  test('throws TypeError on null', () => {
    expect(() => requireDateOnly(null, 'startDate')).toThrow(/Invalid date value for startDate/);
  });

  test('throws TypeError on undefined', () => {
    expect(() => requireDateOnly(undefined, 'startDate')).toThrow(
      /Invalid date value for startDate/,
    );
  });

  test('throws TypeError on empty string', () => {
    expect(() => requireDateOnly('', 'startDate')).toThrow(/Invalid date value for startDate/);
  });
});

describe('todayLocalDateOnly', () => {
  test('returns the current date as YYYY-MM-DD when called without args', () => {
    expect(todayLocalDateOnly()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('uses the provided reference Date', () => {
    expect(todayLocalDateOnly(new Date(2026, 5, 1))).toBe('2026-06-01');
  });
});

describe('isPastLocalDate', () => {
  const reference = new Date(2026, 4, 15);

  test('returns true for an earlier date', () => {
    expect(isPastLocalDate('2026-05-14', reference)).toBe(true);
  });

  test('returns false for the same date', () => {
    expect(isPastLocalDate('2026-05-15', reference)).toBe(false);
  });

  test('returns false for a future date', () => {
    expect(isPastLocalDate('2026-05-16', reference)).toBe(false);
  });

  test('strips a time component from the input before comparing', () => {
    expect(isPastLocalDate('2026-05-14T23:59:59Z', reference)).toBe(true);
  });
});
