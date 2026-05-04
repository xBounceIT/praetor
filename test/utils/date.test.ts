import { describe, expect, test } from 'bun:test';
import {
  addDaysToDateOnly,
  addMonthsToDateOnly,
  dateOnlyStringToLocalDate,
  formatDateOnlyForLocale,
  formatInsertDate,
  getLocalDateString,
  isDateOnlyAfterToday,
  isDateOnlyBeforeToday,
  normalizeDateOnlyString,
} from '../../utils/date';

describe('getLocalDateString', () => {
  test('returns YYYY-MM-DD for the provided Date', () => {
    expect(getLocalDateString(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  test('zero-pads single-digit month and day', () => {
    expect(getLocalDateString(new Date(2026, 8, 5))).toBe('2026-09-05');
  });

  test('without args returns today in YYYY-MM-DD format', () => {
    expect(getLocalDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('normalizeDateOnlyString', () => {
  test('strips a time component from an ISO datetime string', () => {
    expect(normalizeDateOnlyString('2026-05-15T10:30:00Z')).toBe('2026-05-15');
  });

  test('passes a plain YYYY-MM-DD string through unchanged', () => {
    expect(normalizeDateOnlyString('2026-05-15')).toBe('2026-05-15');
  });

  test('returns empty string unchanged', () => {
    expect(normalizeDateOnlyString('')).toBe('');
  });
});

describe('dateOnlyStringToLocalDate', () => {
  test('returns a local Date matching the input components', () => {
    const d = dateOnlyStringToLocalDate('2026-05-15');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4); // May
    expect(d.getDate()).toBe(15);
  });

  test('round-trips with getLocalDateString (no timezone shift)', () => {
    expect(getLocalDateString(dateOnlyStringToLocalDate('2026-05-15'))).toBe('2026-05-15');
  });

  test('strips a time component before parsing', () => {
    const d = dateOnlyStringToLocalDate('2026-05-15T23:59:59Z');
    expect(d.getDate()).toBe(15);
  });
});

describe('formatDateOnlyForLocale', () => {
  test('formats using the supplied locale', () => {
    // en-US default short format is M/D/YYYY
    const formatted = formatDateOnlyForLocale('2026-05-15', 'en-US');
    expect(formatted).toMatch(/5.*15.*2026/);
  });

  test('respects format options (year-only)', () => {
    expect(formatDateOnlyForLocale('2026-05-15', 'en-US', { year: 'numeric' })).toBe('2026');
  });
});

describe('addDaysToDateOnly', () => {
  test('adds positive days within the same month', () => {
    expect(addDaysToDateOnly('2026-05-15', 3)).toBe('2026-05-18');
  });

  test('wraps to the next month when crossing a month boundary', () => {
    expect(addDaysToDateOnly('2026-05-30', 3)).toBe('2026-06-02');
  });

  test('subtracts when given a negative offset', () => {
    expect(addDaysToDateOnly('2026-05-15', -7)).toBe('2026-05-08');
  });

  test('crosses a year boundary', () => {
    expect(addDaysToDateOnly('2025-12-31', 1)).toBe('2026-01-01');
  });

  test('handles leap-day arithmetic', () => {
    expect(addDaysToDateOnly('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDaysToDateOnly('2024-02-29', 1)).toBe('2024-03-01');
  });
});

describe('addMonthsToDateOnly', () => {
  test('adds whole months when target day exists in destination month', () => {
    expect(addMonthsToDateOnly('2026-01-15', 1)).toBe('2026-02-15');
  });

  test('clamps to last day of destination month when target day overflows', () => {
    // Jan 31 + 1 month → Feb 28 (non-leap year 2026)
    expect(addMonthsToDateOnly('2026-01-31', 1)).toBe('2026-02-28');
  });

  test('clamps to Feb 29 in a leap year', () => {
    expect(addMonthsToDateOnly('2024-01-31', 1)).toBe('2024-02-29');
  });

  test('subtracts months for negative offsets', () => {
    expect(addMonthsToDateOnly('2026-03-15', -2)).toBe('2026-01-15');
  });

  test('crosses year boundary for large positive offsets', () => {
    expect(addMonthsToDateOnly('2026-11-15', 3)).toBe('2027-02-15');
  });
});

describe('isDateOnlyBeforeToday / isDateOnlyAfterToday', () => {
  const today = '2026-05-15';

  test('isDateOnlyBeforeToday returns true for an earlier date', () => {
    expect(isDateOnlyBeforeToday('2026-05-14', today)).toBe(true);
  });

  test('isDateOnlyBeforeToday returns false for the same date', () => {
    expect(isDateOnlyBeforeToday('2026-05-15', today)).toBe(false);
  });

  test('isDateOnlyBeforeToday returns false for a future date', () => {
    expect(isDateOnlyBeforeToday('2026-05-16', today)).toBe(false);
  });

  test('isDateOnlyAfterToday is the inverse for non-equal dates', () => {
    expect(isDateOnlyAfterToday('2026-05-16', today)).toBe(true);
    expect(isDateOnlyAfterToday('2026-05-14', today)).toBe(false);
    expect(isDateOnlyAfterToday('2026-05-15', today)).toBe(false);
  });

  test('strips a time component from both sides before comparing', () => {
    expect(isDateOnlyBeforeToday('2026-05-14T23:59:59Z', '2026-05-15T00:00:00Z')).toBe(true);
  });
});

describe('formatInsertDate', () => {
  test('renders "-" for null', () => {
    expect(formatInsertDate(null)).toBe('-');
  });

  test('renders "-" for undefined', () => {
    expect(formatInsertDate(undefined)).toBe('-');
  });

  test('renders "-" for NaN', () => {
    expect(formatInsertDate(Number.NaN)).toBe('-');
  });

  test('formats a valid timestamp as DD/MM/YYYY', () => {
    const ts = new Date(2026, 4, 15).getTime();
    expect(formatInsertDate(ts)).toBe('15/05/2026');
  });

  test('zero-pads single-digit days/months', () => {
    const ts = new Date(2026, 0, 5).getTime();
    expect(formatInsertDate(ts)).toBe('05/01/2026');
  });
});
