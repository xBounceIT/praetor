import { roundCurrency } from './invoice-math.ts';

export const STORED_BILLING_TYPES = ['retainer', 'time_and_materials'] as const;
export const BILLING_TYPES = [...STORED_BILLING_TYPES, 'mixed'] as const;
export const BILLING_FREQUENCIES = ['monthly', 'one_time'] as const;

export type StoredBillingType = (typeof STORED_BILLING_TYPES)[number];
export type BillingType = (typeof BILLING_TYPES)[number];
export type BillingFrequency = (typeof BILLING_FREQUENCIES)[number];

export const DEFAULT_BILLING_TYPE: StoredBillingType = 'time_and_materials';
export const DEFAULT_BILLING_FREQUENCY: BillingFrequency = 'monthly';

export const normalizeBillingFrequency = (
  billingType: StoredBillingType,
  frequency: BillingFrequency | null | undefined,
): BillingFrequency => {
  if (billingType === 'time_and_materials') return 'monthly';
  return frequency ?? DEFAULT_BILLING_FREQUENCY;
};

export const normalizeStoredBillingType = (
  billingType: BillingType | null | undefined,
): StoredBillingType => (billingType === 'retainer' ? 'retainer' : DEFAULT_BILLING_TYPE);

// Compute the cost of a single time entry as `duration * hourlyCost`, rounded to the
// invoice currency precision so totals line up with what the UI renders. Used by
// `entriesRepo.mapBuilderRow` / `mapRawRow` to surface `cost` on read instead of storing
// it - hourly_cost can move retroactively (HR cost changes) but historical entries should
// keep showing the cost at the time the entry was logged, which is what we already store
// per row in `time_entries.hourly_cost`.
export const computeEntryCost = (durationHours: number, hourlyCost: number): number =>
  roundCurrency(durationHours * hourlyCost);
