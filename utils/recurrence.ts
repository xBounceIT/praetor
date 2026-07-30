import type { TFunction } from 'i18next';

const WEEKDAY_TRANSLATION_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

const MONTHLY_OCCURRENCES = ['first', 'second', 'third', 'fourth', 'last'] as const;

export type MonthlyRecurrenceOccurrence = (typeof MONTHLY_OCCURRENCES)[number];

export type MonthlyRecurrencePattern = {
  occurrence: MonthlyRecurrenceOccurrence;
  dayOfWeek: number;
};

export const parseMonthlyRecurrencePattern = (
  pattern: string | undefined,
): MonthlyRecurrencePattern | null => {
  const parts = pattern?.split(':');
  if (parts?.length !== 3 || parts[0] !== 'monthly') return null;

  const occurrence = parts[1] as MonthlyRecurrenceOccurrence;
  if (!/^[0-6]$/.test(parts[2])) return null;
  const dayOfWeek = Number(parts[2]);
  if (!MONTHLY_OCCURRENCES.includes(occurrence)) return null;

  return { occurrence, dayOfWeek };
};

// Parses recurrence patterns like 'daily', 'weekly', 'monthly', or
// 'monthly:first:1' (= every first Monday) into a humanized label.
// Keys are fully namespaced so any caller's `t` works regardless of its
// default namespace.
export const formatRecurrencePattern = (pattern: string | undefined, t: TFunction): string => {
  if (!pattern) return '';
  if (pattern === 'daily') return t('timesheets:entry.recurrencePatterns.daily');
  if (pattern === 'weekly') return t('timesheets:entry.recurrencePatterns.weekly');
  if (pattern === 'monthly') return t('timesheets:entry.recurrencePatterns.monthly');
  const monthlyPattern = parseMonthlyRecurrencePattern(pattern);
  if (monthlyPattern) {
    const { occurrence, dayOfWeek } = monthlyPattern;
    const dayName = t(`timesheets:recurring.dayNames.${WEEKDAY_TRANSLATION_KEYS[dayOfWeek]}`);
    const key = `timesheets:entry.recurrencePatterns.every${
      occurrence.charAt(0).toUpperCase() + occurrence.slice(1)
    }`;
    return t(key, { day: dayName });
  }
  return t('timesheets:entry.recurrencePatterns.custom');
};
