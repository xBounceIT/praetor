// NOTE: `Number.parseFloat` loses precision for values that exceed JavaScript's safe-integer
// range or use more decimal digits than a 64-bit float can represent (e.g. `parseFloat('0.10')`
// returns the IEEE-754 representation, which round-trips back to `'0.1'`). For currency or
// other NUMERIC(p,s) columns where exact decimal fidelity matters, pass the string
// representation through `numericForDb` directly rather than round-tripping via `Number`.
// TODO(precision): callers that ultimately hand parsed numbers back to Drizzle's `numeric`
// columns should be migrated to keep values as strings end-to-end.
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

// Matches an unsigned/signed decimal literal with no scientific notation. Trailing decimal
// point (e.g. `12.`) and leading `+` are intentionally excluded so we forward only strings
// PostgreSQL's NUMERIC input parser accepts cleanly.
const PLAIN_DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

const formatFiniteNumberForDb = (value: number): string => {
  // `String(1e21)` and `String(1e-7)` emit scientific notation, which PostgreSQL's NUMERIC
  // input parser does not accept (it expects a plain decimal literal). `toLocaleString`
  // with `en-US` + `useGrouping: false` is the simplest stdlib path to a plain-decimal
  // representation across the full double range. `maximumFractionDigits: 20` is the spec
  // upper bound and is enough to expose every digit a JS number can carry.
  return value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
};

/**
 * Drizzle's `numeric(p, s)` columns expect string input on insert/update. This helper:
 *   - preserves `null` / `undefined` so COALESCE-style updates still fall through to the
 *     existing column value,
 *   - passes already-formatted decimal strings through unchanged (preserving the caller's
 *     precision exactly),
 *   - and converts finite JS numbers without ever emitting scientific notation, which
 *     PostgreSQL would reject for NUMERIC columns.
 *
 * Precision note: a JS number cannot losslessly represent every value a NUMERIC(p, s)
 * column can hold (e.g. `0.10` becomes `0.1`, currency arithmetic accumulates float error).
 * To preserve full NUMERIC precision, pass strings into this helper whenever possible
 * rather than round-tripping currency values through `Number`.
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
  return formatFiniteNumberForDb(value);
}
