import { describe, expect, test } from 'bun:test';
import {
  BILLING_FREQUENCY_OPTIONS,
  BILLING_TYPE_OPTIONS,
  DEFAULT_BILLING_FREQUENCY,
  DEFAULT_BILLING_TYPE,
  toStoredBillingType,
} from '../../utils/billing';

describe('shared frontend billing module', () => {
  test('defaults match the backend (server/utils/billing.ts) constants', () => {
    // These MUST stay in sync with server/utils/billing.ts DEFAULT_BILLING_TYPE /
    // DEFAULT_BILLING_FREQUENCY. Changing one without the other would split the default a
    // client renders from the one the server persists.
    expect(DEFAULT_BILLING_TYPE).toBe('time_and_materials');
    expect(DEFAULT_BILLING_FREQUENCY).toBe('monthly');
  });

  test('option arrays expose the supported ids in order', () => {
    expect(BILLING_TYPE_OPTIONS.map((o) => o.id)).toEqual(['time_and_materials', 'retainer']);
    expect(BILLING_FREQUENCY_OPTIONS.map((o) => o.id)).toEqual(['monthly', 'one_time']);
  });

  test('toStoredBillingType preserves retainer and coerces everything else to the default', () => {
    expect(toStoredBillingType('retainer')).toBe('retainer');
    expect(toStoredBillingType('time_and_materials')).toBe('time_and_materials');
    expect(toStoredBillingType('mixed')).toBe('time_and_materials');
    expect(toStoredBillingType(undefined)).toBe('time_and_materials');
    expect(toStoredBillingType(null)).toBe('time_and_materials');
  });
});
