import { describe, expect, test } from 'bun:test';
import { formatRecurrencePattern, WEEKDAY_NAMES } from '../../utils/recurrence';

// Stub TFunction: returns the key plus any interpolation values so we can
// assert which keys/args the helper requested without booting i18next.
const stubT = ((key: string, options?: Record<string, unknown>) => {
  if (options?.day) return `${key}|day=${options.day}`;
  return key;
}) as unknown as Parameters<typeof formatRecurrencePattern>[1];

describe('formatRecurrencePattern', () => {
  test('returns empty string for undefined or empty pattern', () => {
    expect(formatRecurrencePattern(undefined, stubT)).toBe('');
    expect(formatRecurrencePattern('', stubT)).toBe('');
  });

  test('maps simple presets to namespaced keys', () => {
    expect(formatRecurrencePattern('daily', stubT)).toBe(
      'timesheets:entry.recurrencePatterns.daily',
    );
    expect(formatRecurrencePattern('weekly', stubT)).toBe(
      'timesheets:entry.recurrencePatterns.weekly',
    );
    expect(formatRecurrencePattern('monthly', stubT)).toBe(
      'timesheets:entry.recurrencePatterns.monthly',
    );
  });

  test('humanizes monthly:occurrence:dayIdx into "every<Occurrence>" with day name', () => {
    expect(formatRecurrencePattern('monthly:first:1', stubT)).toBe(
      'timesheets:entry.recurrencePatterns.everyFirst|day=Monday',
    );
    expect(formatRecurrencePattern('monthly:last:0', stubT)).toBe(
      'timesheets:entry.recurrencePatterns.everyLast|day=Sunday',
    );
    expect(formatRecurrencePattern('monthly:third:6', stubT)).toBe(
      'timesheets:entry.recurrencePatterns.everyThird|day=Saturday',
    );
  });

  test('falls back to custom when monthly: pattern has wrong arity', () => {
    expect(formatRecurrencePattern('monthly:first', stubT)).toBe(
      'timesheets:entry.recurrencePatterns.custom',
    );
    expect(formatRecurrencePattern('monthly:first:1:extra', stubT)).toBe(
      'timesheets:entry.recurrencePatterns.custom',
    );
  });

  test('WEEKDAY_NAMES indexes match JavaScript Date.getDay() (0=Sunday)', () => {
    expect(WEEKDAY_NAMES[0]).toBe('Sunday');
    expect(WEEKDAY_NAMES[1]).toBe('Monday');
    expect(WEEKDAY_NAMES[6]).toBe('Saturday');
    expect(WEEKDAY_NAMES).toHaveLength(7);
  });
});
