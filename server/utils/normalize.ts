/**
 * Route-layer normalizers for nullable line-item fields. Shared by the quote / offer / order
 * item validators so a blank, whitespace-only, or absent value lands as NULL consistently
 * across the document chain — previously each route inlined its own copy and they had drifted
 * (some trimmed, some did not, so a whitespace-only supplier-quote id persisted on orders/offers
 * but normalized to null on quotes).
 */

/**
 * Coerce an arbitrary request value to a trimmed, non-empty string — or null.
 *
 * `undefined`/`null` → null; otherwise `String(value).trim()`, with a whitespace-only result
 * collapsing to null. So a blank supplier-quote id never persists as `''` or `'  '`.
 */
export const normalizeNullableString = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  const stringValue = String(value).trim();
  return stringValue.length > 0 ? stringValue : null;
};

/**
 * Coerce an arbitrary request value to a number — or null.
 *
 * `undefined`/`null` → null; otherwise `Number(value)`. The line-item body schemas validate
 * these fields as numbers, so for valid input the coercion is effectively identity; this is the
 * numeric mirror of {@link normalizeNullableString} for the nullable cost / MOL% / supplier
 * unit-price fields.
 */
export const normalizeNullableNumber = (value: unknown): number | null =>
  value === undefined || value === null ? null : Number(value);
