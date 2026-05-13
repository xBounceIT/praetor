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

// PostgreSQL NUMERIC input rejects scientific notation, trailing decimal points, and leading `+`.
const PLAIN_DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

// Cached so we don't pay per-call `Intl.NumberFormat` instantiation on the financial write path.
// `en-US` is chosen for its decimal-point separator (independent of app locale); `useGrouping:false`
// avoids thousands separators; `maximumFractionDigits: 20` is the spec ceiling, enough for any
// finite double. `String(1e21)` / `String(1e-7)` would emit scientific notation.
const PLAIN_DECIMAL_FORMATTER = new Intl.NumberFormat('en-US', {
  useGrouping: false,
  maximumFractionDigits: 20,
});

/**
 * Drizzle's `numeric(p, s)` columns expect string input. Pass plain-decimal strings through
 * unchanged to preserve precision (e.g. `'0.10'` survives as `'0.10'`, not `'0.1'`); finite
 * numbers are formatted without scientific notation; `null`/`undefined` pass through so
 * COALESCE-style updates still fall through to the existing column value.
 */
export function numericForDb(value: number | string): string;
export function numericForDb(value: number | string | null): string | null;
export function numericForDb(value: number | string | null | undefined): string | null | undefined;
export function numericForDb(value: number | string | null | undefined): string | null | undefined {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!PLAIN_DECIMAL_PATTERN.test(trimmed)) {
      throw new TypeError(
        `numericForDb: string value ${JSON.stringify(value)} is not a plain decimal literal`,
      );
    }
    return trimmed;
  }
  if (!Number.isFinite(value)) {
    throw new TypeError(`numericForDb: value ${String(value)} is not a finite number`);
  }
  return PLAIN_DECIMAL_FORMATTER.format(value);
}
