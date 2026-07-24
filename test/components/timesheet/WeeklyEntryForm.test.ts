import { describe, expect, test } from 'bun:test';
import { dateOnlyStringToLocalDate, formatDateOnlyForLocale } from '../../../utils/date';

describe('WeeklyEntryForm date-only display', () => {
  test('formats selectedDate via local date-only helper, not UTC Date parsing', async () => {
    const source = await Bun.file(
      new URL('../../../components/timesheet/WeeklyEntryForm.tsx', import.meta.url),
    ).text();

    expect(source).toContain("import { formatDateOnlyForLocale } from '../../utils/date'");
    expect(source).toContain(
      "formatDateOnlyForLocale(selectedDate, undefined, { weekday: 'long' })",
    );
    expect(source).toContain('formatDateOnlyForLocale(selectedDate, undefined, {');
    expect(source).not.toContain('new Date(selectedDate)');
  });

  test('local helper keeps the calendar day for date-only strings', () => {
    // Regression for UTC-negative zones: `new Date('YYYY-MM-DD')` is UTC midnight
    // and can render as the previous local day via toLocaleDateString.
    const dateOnly = '2026-05-15';
    const localDate = dateOnlyStringToLocalDate(dateOnly);

    expect(localDate.getFullYear()).toBe(2026);
    expect(localDate.getMonth()).toBe(4);
    expect(localDate.getDate()).toBe(15);
    expect(formatDateOnlyForLocale(dateOnly, 'en-US', { weekday: 'long' })).toBe(
      localDate.toLocaleDateString('en-US', { weekday: 'long' }),
    );
    expect(
      formatDateOnlyForLocale(dateOnly, 'en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    ).toBe(
      localDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    );
  });
});
