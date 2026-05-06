/**
 * Returns the current date (or a specific date) as an ISO-formatted string (YYYY-MM-DD)
 * using the local timezone instead of UTC.
 */
export const getLocalDateString = (date: Date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const normalizeDateOnlyString = (value: string): string => {
  const separatorIndex = value.indexOf('T');
  return separatorIndex >= 0 ? value.slice(0, separatorIndex) : value;
};

export const dateOnlyStringToLocalDate = (dateOnly: string): Date => {
  const normalizedDate = normalizeDateOnlyString(dateOnly);
  const [year, month, day] = normalizedDate.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export const formatDateOnlyForLocale = (
  dateOnly: string,
  locales?: string | string[],
  options?: Intl.DateTimeFormatOptions,
): string => dateOnlyStringToLocalDate(dateOnly).toLocaleDateString(locales, options);

export const addDaysToDateOnly = (dateOnly: string, days: number): string => {
  const nextDate = dateOnlyStringToLocalDate(dateOnly);
  nextDate.setDate(nextDate.getDate() + days);
  return getLocalDateString(nextDate);
};

export const addMonthsToDateOnly = (dateOnly: string, months: number): string => {
  const nextDate = dateOnlyStringToLocalDate(dateOnly);
  const targetDay = nextDate.getDate();
  nextDate.setMonth(nextDate.getMonth() + months);
  if (nextDate.getDate() !== targetDay) {
    nextDate.setDate(0);
  }
  return getLocalDateString(nextDate);
};

export const isDateOnlyBeforeToday = (
  dateOnly: string,
  today: string = getLocalDateString(),
): boolean => normalizeDateOnlyString(dateOnly) < normalizeDateOnlyString(today);

export const isDateOnlyAfterToday = (
  dateOnly: string,
  today: string = getLocalDateString(),
): boolean => normalizeDateOnlyString(dateOnly) > normalizeDateOnlyString(today);

/**
 * Formats a Unix timestamp (milliseconds) to a DD/MM/YYYY date string.
 * Returns '-' for invalid, null, or undefined timestamps.
 */
export const formatInsertDate = (timestamp: number | null | undefined): string => {
  if (timestamp === null || timestamp === undefined) return '-';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '-';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

export const formatInsertDateTime = (
  timestamp: number | null | undefined,
  locales?: string | string[],
): string => {
  if (timestamp === null || timestamp === undefined) return '-';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(locales, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};
