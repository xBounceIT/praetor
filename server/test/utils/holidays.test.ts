import { describe, expect, test } from 'bun:test';
import { getEaster, isItalianHoliday } from '../../utils/holidays.ts';

describe('server isItalianHoliday', () => {
  test('Capodanno (January 1)', () => {
    expect(isItalianHoliday(new Date(2025, 0, 1))).toBe('Capodanno');
  });

  test('Festa della Repubblica (June 2)', () => {
    expect(isItalianHoliday(new Date(2025, 5, 2))).toBe('Repubblica');
  });

  test('Natale (December 25)', () => {
    expect(isItalianHoliday(new Date(2025, 11, 25))).toBe('Natale');
  });

  test('non-holiday weekday returns null', () => {
    // 2025-06-10 is a Tuesday, no Italian holiday
    expect(isItalianHoliday(new Date(2025, 5, 10))).toBeNull();
  });

  test("computes Easter and Lunedì dell'Angelo correctly for 2025", () => {
    // Easter 2025 is April 20
    const easter = getEaster(2025);
    expect(easter.getFullYear()).toBe(2025);
    expect(easter.getMonth()).toBe(3);
    expect(easter.getDate()).toBe(20);

    expect(isItalianHoliday(new Date(2025, 3, 20))).toBe('Pasqua');
    expect(isItalianHoliday(new Date(2025, 3, 21))).toBe("Lunedì dell'Angelo");
  });

  test('getEaster returns a fresh Date each call so callers can mutate safely', () => {
    const a = getEaster(2025);
    const b = getEaster(2025);
    expect(a).not.toBe(b);
    expect(a.getTime()).toBe(b.getTime());

    // Mutating the returned Date must not poison subsequent calls.
    a.setDate(a.getDate() + 10);
    const c = getEaster(2025);
    expect(c.getMonth()).toBe(3);
    expect(c.getDate()).toBe(20);
  });
});
