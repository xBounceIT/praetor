const padDatePart = (value: number) => String(value).padStart(2, '0');

const extractDateOnlyString = (value: string) => {
  const separatorIndex = value.indexOf('T');
  return separatorIndex >= 0 ? value.slice(0, separatorIndex) : value;
};

export const formatLocalDateOnly = (date: Date) => {
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  return `${year}-${month}-${day}`;
};

export const normalizeNullableDateOnly = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return formatLocalDateOnly(value);
  if (typeof value === 'string') return extractDateOnlyString(value);
  throw new TypeError(`Invalid date value for ${fieldName}`);
};

export const requireDateOnly = (value: unknown, fieldName: string): string => {
  const normalized = normalizeNullableDateOnly(value, fieldName);
  if (!normalized) throw new TypeError(`Invalid date value for ${fieldName}`);
  return normalized;
};

export const todayLocalDateOnly = (now: Date = new Date()) => formatLocalDateOnly(now);

export const isPastLocalDate = (dateOnly: string, now: Date = new Date()) =>
  extractDateOnlyString(dateOnly) < formatLocalDateOnly(now);
