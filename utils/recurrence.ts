import type { TFunction } from 'i18next';

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

// Parses recurrence patterns like 'daily', 'weekly', 'monthly', or
// 'monthly:first:1' (= every first Monday) into a humanized label.
// Keys are fully namespaced so any caller's `t` works regardless of its
// default namespace.
export const formatRecurrencePattern = (pattern: string | undefined, t: TFunction): string => {
  if (!pattern) return '';
  if (pattern === 'daily') return t('timesheets:entry.recurrencePatterns.daily');
  if (pattern === 'weekly') return t('timesheets:entry.recurrencePatterns.weekly');
  if (pattern === 'monthly') return t('timesheets:entry.recurrencePatterns.monthly');
  if (pattern.startsWith('monthly:')) {
    const parts = pattern.split(':');
    if (parts.length === 3) {
      const occurrence = parts[1];
      const dayIdx = parseInt(parts[2], 10);
      const dayName = WEEKDAY_NAMES[dayIdx];
      const key = `timesheets:entry.recurrencePatterns.every${
        occurrence.charAt(0).toUpperCase() + occurrence.slice(1)
      }`;
      return t(key, { day: dayName });
    }
  }
  return t('timesheets:entry.recurrencePatterns.custom');
};
