// `duration_months` stays in canonical whole months for API/data compatibility. Pricing uses the
// numeric value represented by `duration_unit`; 'na' remains neutral. Mirrors the frontend type.
export const DURATION_UNITS = ['months', 'years', 'na'] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

import {
  LEGACY_PRICING_SEMANTICS_VERSION,
  normalizePricingSemanticsVersion,
  type PricingSemanticsVersion,
} from './pricing-semantics.ts';

export const normalizeDurationUnit = (value: unknown): DurationUnit =>
  value === 'years' ? 'years' : value === 'na' ? 'na' : 'months';

// When an API caller omits the canonical value, persist the months that represent a neutral ×1 in
// the requested unit. This keeps validation-time and persisted pricing aligned for "years".
export const defaultDurationMonthsForUnit = (durationUnit: unknown): number =>
  normalizeDurationUnit(durationUnit) === 'years' ? 12 : 1;

// Read the canonical stored months, applying the legacy neutral fallback and N/A gate. Economic
// calculations must use `effectiveDurationMultiplier` below.
export const effectiveDurationMonths = (durationUnit: unknown, durationMonths: unknown): number => {
  if (normalizeDurationUnit(durationUnit) === 'na') return 1;
  const months = Number(durationMonths ?? 1);
  return Number.isFinite(months) && months > 0 ? months : 1;
};

// Pricing uses the numeric value shown in the selected unit, while persistence remains canonical
// whole months for backward compatibility. Thus 12 stored months labelled as one year multiply by
// 1; the same 12 stored months labelled as months multiply by 12. N/A remains the neutral ×1.
export const effectiveDurationMultiplier = (
  durationUnit: unknown,
  durationMonths: unknown,
  pricingSemanticsVersion?: PricingSemanticsVersion,
): number => {
  const normalizedUnit = normalizeDurationUnit(durationUnit);
  if (normalizedUnit === 'na') return 1;
  const storedMonths = Number(durationMonths);
  if (!Number.isFinite(storedMonths) || storedMonths <= 0) return 1;
  if (
    normalizePricingSemanticsVersion(pricingSemanticsVersion) === LEGACY_PRICING_SEMANTICS_VERSION
  ) {
    return storedMonths;
  }
  return normalizedUnit === 'years' ? storedMonths / 12 : storedMonths;
};
