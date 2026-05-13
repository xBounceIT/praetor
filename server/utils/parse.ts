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

const PLAIN_DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

// `new Intl.NumberFormat` is ~1ms per call and this runs on every NUMERIC write.
const PLAIN_DECIMAL_FORMATTER = new Intl.NumberFormat('en-US', {
  useGrouping: false,
  maximumFractionDigits: 20,
});

/** Drizzle `numeric()` columns expect strings; preserves precision and avoids scientific notation. */
export function numericForDb(value: number | string): string;
export function numericForDb(value: number | string | null): string | null;
export function numericForDb(value: number | string | null | undefined): string | null | undefined;
export function numericForDb(value: number | string | null | undefined): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!PLAIN_DECIMAL_PATTERN.test(trimmed)) {
      throw new TypeError(`numericForDb: "${value}" is not a plain decimal literal`);
    }
    return trimmed;
  }
  if (!Number.isFinite(value)) {
    throw new TypeError(`numericForDb: ${String(value)} is not a finite number`);
  }
  return PLAIN_DECIMAL_FORMATTER.format(value);
}
