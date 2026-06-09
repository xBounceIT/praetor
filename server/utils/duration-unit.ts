// Display unit for a line-item duration (issue #757). `duration_months` stays the canonical
// pricing multiplier (always whole months); `duration_unit` only controls how that value is
// shown/entered. 'na' (N/A) marks a line where duration does not apply and never multiplies
// (issue #775). Mirrors the frontend `DurationUnit` in `types.ts` — kept separate because
// routes/repos can't reach across the frontend/backend split.
export const DURATION_UNITS = ['months', 'years', 'na'] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

export const normalizeDurationUnit = (value: unknown): DurationUnit =>
  value === 'years' ? 'years' : value === 'na' ? 'na' : 'months';

// Canonical whole months a line multiplies by (issue #757). 'na' (N/A) marks a line where duration
// does not apply, so it never multiplies regardless of the stored months (issue #775); absent or
// non-positive values fall back to a single month. The single backend source of truth for the 'na'
// rule — used by both `computeInvoiceTotals` and the quote-total gate so a new multiplier can't
// silently forget it. Mirrors the frontend `getEffectiveDurationMonths` in `utils/numbers.ts`.
export const effectiveDurationMonths = (durationUnit: unknown, durationMonths: unknown): number => {
  if (normalizeDurationUnit(durationUnit) === 'na') return 1;
  const months = Number(durationMonths ?? 1);
  return Number.isFinite(months) && months > 0 ? months : 1;
};
