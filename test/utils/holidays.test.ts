import { describe, expect, test } from 'bun:test';
import enHolidays from '../../locales/en/holidays.json';
import itHolidays from '../../locales/it/holidays.json';
import { getLocalDateString } from '../../utils/date';
import { getEaster, isItalianHoliday } from '../../utils/holidays';

describe('getEaster', () => {
  test.each([
    [2020, '2020-04-12'],
    [2021, '2021-04-04'],
    [2022, '2022-04-17'],
    [2023, '2023-04-09'],
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2028, '2028-04-16'],
    [2029, '2029-04-01'],
    [2030, '2030-04-21'],
  ])('returns the correct Easter Sunday for %i', (year, expected) => {
    expect(getLocalDateString(getEaster(year))).toBe(expected);
  });

  test('returns a Date instance', () => {
    expect(getEaster(2026)).toBeInstanceOf(Date);
  });
});

describe('isItalianHoliday - fixed dates', () => {
  test.each([
    ['2026-01-01', 'newYear'],
    ['2026-01-06', 'epiphany'],
    ['2026-04-25', 'liberationDay'],
    ['2026-05-01', 'laborDay'],
    ['2026-06-02', 'republicDay'],
    ['2026-08-15', 'assumption'],
    ['2026-11-01', 'allSaints'],
    ['2026-12-08', 'immaculateConception'],
    ['2026-12-25', 'christmas'],
    ['2026-12-26', 'stStephen'],
  ])('%s → %s', (dateStr, expected) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    expect(isItalianHoliday(new Date(y, m - 1, d))).toBe(expected);
  });
});

describe('isItalianHoliday - moveable feasts', () => {
  test('returns the Easter key on Easter Sunday', () => {
    expect(isItalianHoliday(new Date(2026, 3, 5))).toBe('easter');
  });

  test('returns the Easter Monday key the day after Easter', () => {
    expect(isItalianHoliday(new Date(2026, 3, 6))).toBe('easterMonday');
  });

  test('returns null for the day before Easter (Good Saturday is not a public holiday in Italy)', () => {
    expect(isItalianHoliday(new Date(2026, 3, 4))).toBeNull();
  });

  test('Easter Monday rolls forward correctly when Easter is on March 31 (boundary into April)', () => {
    expect(isItalianHoliday(new Date(2024, 2, 31))).toBe('easter');
    expect(isItalianHoliday(new Date(2024, 3, 1))).toBe('easterMonday');
  });

  test('returned key resolves through the holidays namespace in both languages', () => {
    const key = isItalianHoliday(new Date(2026, 0, 1));
    expect(key).not.toBeNull();
    const lookupKey = key as keyof typeof itHolidays;
    expect(itHolidays[lookupKey]).toBe('Capodanno');
    expect(enHolidays[lookupKey]).toBe("New Year's Day");
  });
});

describe('isItalianHoliday - non-holidays', () => {
  test('returns null for an ordinary weekday', () => {
    expect(isItalianHoliday(new Date(2026, 5, 15))).toBeNull();
  });

  test('returns null for an ordinary weekend day', () => {
    expect(isItalianHoliday(new Date(2026, 5, 13))).toBeNull();
  });

  test('returns null for the day before a fixed holiday', () => {
    expect(isItalianHoliday(new Date(2026, 11, 24))).toBeNull();
  });

  test('returns null for the day after a fixed holiday', () => {
    expect(isItalianHoliday(new Date(2026, 11, 27))).toBeNull();
  });
});
