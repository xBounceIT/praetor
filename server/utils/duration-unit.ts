// Display unit for a line-item duration (issue #757). `duration_months` stays the canonical
// pricing multiplier (always whole months); `duration_unit` only controls how that value is
// shown/entered. 'na' (N/A) marks a line where duration does not apply and never multiplies
// (issue #775). Mirrors the frontend `DurationUnit` in `types.ts` — kept separate because
// routes/repos can't reach across the frontend/backend split.
export const DURATION_UNITS = ['months', 'years', 'na'] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

export const normalizeDurationUnit = (value: unknown): DurationUnit =>
  value === 'years' ? 'years' : value === 'na' ? 'na' : 'months';
