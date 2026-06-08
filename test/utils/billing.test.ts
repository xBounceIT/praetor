import { describe, expect, test } from 'bun:test';
import {
  BILLING_FREQUENCIES as SERVER_BILLING_FREQUENCIES,
  DEFAULT_BILLING_FREQUENCY as SERVER_DEFAULT_BILLING_FREQUENCY,
  DEFAULT_BILLING_TYPE as SERVER_DEFAULT_BILLING_TYPE,
  STORED_BILLING_TYPES as SERVER_STORED_BILLING_TYPES,
} from '../../server/utils/billing';
import {
  BILLING_FREQUENCY_OPTIONS,
  BILLING_TYPE_OPTIONS,
  DEFAULT_BILLING_FREQUENCY,
  DEFAULT_BILLING_TYPE,
  normalizeBillingFrequency,
  toStoredBillingType,
} from '../../utils/billing';

const sorted = (values: readonly string[]) => [...values].sort();

describe('shared frontend billing module', () => {
  test('defaults equal the backend (server/utils/billing.ts) constants', () => {
    // Assert real equality against the backend rather than pinning literals, so a change to
    // one side without the other fails here instead of silently splitting the default a client
    // renders from the one the server persists.
    expect(DEFAULT_BILLING_TYPE).toBe(SERVER_DEFAULT_BILLING_TYPE);
    expect(DEFAULT_BILLING_FREQUENCY).toBe(SERVER_DEFAULT_BILLING_FREQUENCY);
  });

  test('option ids cover exactly the billing values the backend accepts', () => {
    // Order may differ (the dropdowns list time_and_materials first; the backend lists retainer
    // first), so compare as sets. Guards against a value added on one tier but not the other.
    expect(sorted(BILLING_TYPE_OPTIONS.map((o) => o.id))).toEqual(
      sorted(SERVER_STORED_BILLING_TYPES),
    );
    expect(sorted(BILLING_FREQUENCY_OPTIONS.map((o) => o.id))).toEqual(
      sorted(SERVER_BILLING_FREQUENCIES),
    );
  });

  test('toStoredBillingType preserves retainer and coerces everything else to the default', () => {
    expect(toStoredBillingType('retainer')).toBe('retainer');
    expect(toStoredBillingType('time_and_materials')).toBe('time_and_materials');
    expect(toStoredBillingType('mixed')).toBe('time_and_materials');
    expect(toStoredBillingType(undefined)).toBe('time_and_materials');
    expect(toStoredBillingType(null)).toBe('time_and_materials');
  });

  test('normalizeBillingFrequency coalesces only a missing value to the default', () => {
    expect(normalizeBillingFrequency('one_time')).toBe('one_time');
    expect(normalizeBillingFrequency('monthly')).toBe('monthly');
    expect(normalizeBillingFrequency(undefined)).toBe(DEFAULT_BILLING_FREQUENCY);
    expect(normalizeBillingFrequency(null)).toBe(DEFAULT_BILLING_FREQUENCY);
  });
});
