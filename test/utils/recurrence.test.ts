import { describe, expect, test } from 'bun:test';
import { formatRecurrencePattern } from '../../utils/recurrence';

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
      'timesheets:entry.recurrencePatterns.everyFirst|day=timesheets:recurring.dayNames.monday',
    );
    expect(formatRecurrencePattern('monthly:last:0', stubT)).toBe(
      'timesheets:entry.recurrencePatterns.everyLast|day=timesheets:recurring.dayNames.sunday',
    );
    expect(formatRecurrencePattern('monthly:third:6', stubT)).toBe(
      'timesheets:entry.recurrencePatterns.everyThird|day=timesheets:recurring.dayNames.saturday',
    );
  });

  test('resolves custom recurrence weekdays through localized day-name keys', () => {
    const italianT = ((key: string, options?: Record<string, unknown>) => {
      if (key === 'timesheets:recurring.dayNames.friday') return 'Venerdì';
      if (options?.day) return `${key}|day=${options.day}`;
      return key;
    }) as unknown as Parameters<typeof formatRecurrencePattern>[1];

    expect(formatRecurrencePattern('monthly:last:5', italianT)).toBe(
      'timesheets:entry.recurrencePatterns.everyLast|day=Venerdì',
    );
  });

  test('falls back to custom when monthly: pattern has wrong arity', () => {
    expect(formatRecurrencePattern('monthly:first', stubT)).toBe(
      'timesheets:entry.recurrencePatterns.custom',
    );
    expect(formatRecurrencePattern('monthly:first:1:extra', stubT)).toBe(
      'timesheets:entry.recurrencePatterns.custom',
    );
    expect(formatRecurrencePattern('monthly:first:', stubT)).toBe(
      'timesheets:entry.recurrencePatterns.custom',
    );
  });
});
