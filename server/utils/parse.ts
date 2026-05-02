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
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  return Number.isFinite(n) ? n : null;
};

export const toDbText = (value: unknown): string => String(value ?? '').trim();

export const toDbNumber = (value: unknown): number =>
  parseDbNumber(value as string | number | null | undefined, 0);

// Drizzle's `numeric` columns expect strings on insert/update. Preserve null/undefined so
// COALESCE-style updates can still fall through to the existing column value.
export function numericForDb(value: number): string;
export function numericForDb(value: number | null): string | null;
export function numericForDb(value: number | null | undefined): string | null | undefined;
export function numericForDb(value: number | null | undefined): string | null | undefined {
  return value === null || value === undefined ? value : String(value);
}
