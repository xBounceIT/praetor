/**
 * Format the overtime hours carried in an `overtime_recorded` notification's
 * `data.hours` for display inside a localized notification title. Accepts the
 * numeric value written by the server today and coerces string JSONB values from
 * legacy or hand-edited rows. Whole hours render without decimals (8 -> "8"),
 * fractional hours with two decimals (8.5 -> "8.50"), matching the server's
 * message format. Non-numeric values render as an empty string so the title
 * never shows "NaN" or "undefined".
 */
export const formatOvertimeHours = (hours: unknown): string => {
  if (hours === null || hours === undefined) return '';
  const value = Number(hours);
  if (!Number.isFinite(value)) return '';
  return value % 1 === 0 ? String(value) : value.toFixed(2);
};
