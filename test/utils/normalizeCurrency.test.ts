import { describe, expect, test } from 'bun:test';
import { normalizeCurrency } from '../../utils/normalizeCurrency';

describe('normalizeCurrency', () => {
  test('maps the legacy "USD" code to the "$" symbol', () => {
    expect(normalizeCurrency('USD')).toBe('$');
  });

  test('is idempotent on "$"', () => {
    expect(normalizeCurrency('$')).toBe('$');
  });

  test('leaves the euro symbol untouched', () => {
    expect(normalizeCurrency('€')).toBe('€');
  });

  test('leaves multi-character symbols like "CHF" untouched', () => {
    expect(normalizeCurrency('CHF')).toBe('CHF');
  });
});
