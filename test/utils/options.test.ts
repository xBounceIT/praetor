import { describe, expect, test } from 'bun:test';
import { getPaymentTermsOptions } from '../../utils/options';

describe('getPaymentTermsOptions', () => {
  // Stub `t` function: simply echoes the key so we can assert ids/keys map up.
  const t = (key: string) => key;

  test('returns the canonical list of 11 payment-term options', () => {
    const opts = getPaymentTermsOptions(t);
    expect(opts).toHaveLength(11);
  });

  test('first option is "immediate" with the matching translation key', () => {
    const opts = getPaymentTermsOptions(t);
    expect(opts[0]).toEqual({ id: 'immediate', name: 'crm:paymentTerms.immediate' });
  });

  test('every option uses the crm:paymentTerms.<id> translation key naming convention', () => {
    const opts = getPaymentTermsOptions(t);
    for (const opt of opts) {
      expect(opt.name).toBe(`crm:paymentTerms.${opt.id}`);
    }
  });

  test('preserves the documented order (immediate, 15gg, 21gg, 30gg, ...)', () => {
    const ids = getPaymentTermsOptions(t).map((o) => o.id);
    expect(ids).toEqual([
      'immediate',
      '15gg',
      '21gg',
      '30gg',
      '45gg',
      '60gg',
      '90gg',
      '120gg',
      '180gg',
      '240gg',
      '365gg',
    ]);
  });

  test('passes the key through to the supplied translator (no fallback strings)', () => {
    const calls: string[] = [];
    const recorder = (key: string) => {
      calls.push(key);
      return `tr(${key})`;
    };
    const opts = getPaymentTermsOptions(recorder);
    expect(calls).toHaveLength(11);
    expect(opts[2]).toEqual({ id: '21gg', name: 'tr(crm:paymentTerms.21gg)' });
  });
});
