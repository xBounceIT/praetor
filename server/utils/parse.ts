export const parseDbNumber = <T extends number | undefined>(
  value: string | number | null | undefined,
  fallback: T,
): number | T => {
  if (value === null || value === undefined) return fallback;
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  return Number.isFinite(n) ? n : fallback;
};

export const parseNullableDbNumber = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  return parseDbNumber(value, 0);
};
