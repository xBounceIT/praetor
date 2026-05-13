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
});
