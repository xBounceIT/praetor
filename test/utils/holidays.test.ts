import { describe, expect, test } from 'bun:test';
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

describe('isItalianHoliday — fixed dates', () => {
  test.each([
    ['2026-01-01', 'Capodanno'],
    ['2026-01-06', 'Epifania'],
    ['2026-04-25', 'Liberazione'],
    ['2026-05-01', 'Lavoro'],
    ['2026-06-02', 'Repubblica'],
    ['2026-08-15', 'Ferragosto'],
    ['2026-11-01', 'Ognissanti'],
    ['2026-12-08', 'Immacolata'],
    ['2026-12-25', 'Natale'],
    ['2026-12-26', 'S. Stefano'],
  ])('%s → %s', (dateStr, expected) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    expect(isItalianHoliday(new Date(y, m - 1, d))).toBe(expected);
  });
});

describe('isItalianHoliday — moveable feasts', () => {
  test('returns "Pasqua" on Easter Sunday', () => {
    expect(isItalianHoliday(new Date(2026, 3, 5))).toBe('Pasqua');
  });

  test('returns "Lunedì dell\'Angelo" the day after Easter', () => {
    expect(isItalianHoliday(new Date(2026, 3, 6))).toBe("Lunedì dell'Angelo");
  });

  test('returns null for the day before Easter (Good Saturday is not a public holiday in Italy)', () => {
    expect(isItalianHoliday(new Date(2026, 3, 4))).toBeNull();
  });

  test('Easter Monday rolls forward correctly when Easter is on March 31 (boundary into April)', () => {
    expect(isItalianHoliday(new Date(2024, 2, 31))).toBe('Pasqua');
    expect(isItalianHoliday(new Date(2024, 3, 1))).toBe("Lunedì dell'Angelo");
  });
});

describe('isItalianHoliday — non-holidays', () => {
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
