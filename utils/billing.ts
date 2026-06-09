import type { BillingFrequency, BillingType, StoredBillingType } from '../types';

// Frontend counterpart to server/utils/billing.ts. Billing type (retainer | time_and_materials)
// and frequency (monthly | one_time) are independent — both types support either frequency
// (issue #785). These defaults MUST stay in sync with the backend constants of the same name;
// test/utils/billing.test.ts pins the expected values.
export const DEFAULT_BILLING_TYPE: StoredBillingType = 'time_and_materials';
export const DEFAULT_BILLING_FREQUENCY: BillingFrequency = 'monthly';

// i18n key option arrays — translate at the call site with `t(option.name)`.
export const BILLING_TYPE_OPTIONS: readonly { id: StoredBillingType; name: string }[] = [
  { id: 'time_and_materials', name: 'projects:projects.billingTypes.timeAndMaterials' },
  { id: 'retainer', name: 'projects:projects.billingTypes.retainer' },
];

export const BILLING_FREQUENCY_OPTIONS: readonly { id: BillingFrequency; name: string }[] = [
  { id: 'monthly', name: 'projects:projects.billingFrequencies.monthly' },
  { id: 'one_time', name: 'projects:projects.billingFrequencies.oneTime' },
];

// Coerce a possibly-derived ('mixed') or missing billing type to a stored value. Mirrors the
// backend normalizeStoredBillingType.
export const toStoredBillingType = (
  billingType: BillingType | null | undefined,
): StoredBillingType => (billingType === 'retainer' ? 'retainer' : DEFAULT_BILLING_TYPE);

// Coalesce a missing billing frequency to the default. Mirrors the backend
// normalizeBillingFrequency — frequency is independent of billing type (issue #785).
export const normalizeBillingFrequency = (
  billingFrequency: BillingFrequency | null | undefined,
): BillingFrequency => billingFrequency ?? DEFAULT_BILLING_FREQUENCY;
