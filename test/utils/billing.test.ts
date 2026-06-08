import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_BILLING_FREQUENCY as SERVER_DEFAULT_BILLING_FREQUENCY,
  DEFAULT_BILLING_TYPE as SERVER_DEFAULT_BILLING_TYPE,
} from '../../server/utils/billing';
import {
  BILLING_FREQUENCY_OPTIONS,
  BILLING_TYPE_OPTIONS,
  DEFAULT_BILLING_FREQUENCY,
  DEFAULT_BILLING_TYPE,
  toStoredBillingType,
} from '../../utils/billing';

describe('shared frontend billing module', () => {
  test('defaults equal the backend (server/utils/billing.ts) constants', () => {
    // Assert real equality against the backend rather than pinning literals, so a change to
    // one side without the other fails here instead of silently splitting the default a client
    // renders from the one the server persists.
    expect(DEFAULT_BILLING_TYPE).toBe(SERVER_DEFAULT_BILLING_TYPE);
    expect(DEFAULT_BILLING_FREQUENCY).toBe(SERVER_DEFAULT_BILLING_FREQUENCY);
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
