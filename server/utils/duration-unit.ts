// Display unit for a line-item duration (issue #757). `duration_months` stays the canonical
// pricing multiplier (always whole months); `duration_unit` only controls how that value is
// shown/entered. Mirrors the frontend `DurationUnit` in `types.ts` — kept separate because
// routes/repos can't reach across the frontend/backend split.
export const DURATION_UNITS = ['months', 'years'] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

export const normalizeDurationUnit = (value: unknown): DurationUnit =>
  value === 'years' ? 'years' : 'months';
