// Display unit for a line-item duration (issue #757). `duration_months` stays the canonical
// pricing multiplier (always whole months); `duration_unit` only controls how that value is
// shown/entered. Mirrors the frontend `DurationUnit` in `types.ts` — kept separate because
// routes/repos can't reach across the frontend/backend split.
export const DURATION_UNITS = ['months', 'years'] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

export const normalizeDurationUnit = (value: unknown): DurationUnit =>
  value === 'years' ? 'years' : 'months';

// A "unit"-measured line is a countable quantity (e.g. 40 units), not a service that runs over a
// period, so it cannot carry a duration. Quotes/offers/orders carry the unit in `unitType`,
// invoices in `unitOfMeasure`; either being 'unit' marks the line. ('days'/'hours' keep duration.)
export const isUnitMeasure = (unit: string | null | undefined): boolean => unit === 'unit';

// Forces a unit-measured line's duration to a single month server-side, regardless of client
// input. Apply wherever a line's unit and duration are both resolved (route normalize + repo
// insert) so the rule holds for POST, PUT, and version-restore alike.
export const coerceUnitLineDuration = (
  isUnit: boolean,
  durationMonths: number,
  durationUnit: DurationUnit,
): { durationMonths: number; durationUnit: DurationUnit } =>
  isUnit ? { durationMonths: 1, durationUnit: 'months' } : { durationMonths, durationUnit };
