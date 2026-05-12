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
