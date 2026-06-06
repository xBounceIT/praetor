import { describe, expect, test } from 'bun:test';
import { roundCurrency } from '../../utils/invoice-math.ts';
import { deriveSupplierLinePricing } from '../../utils/supplier-quote-pricing.ts';

describe('deriveSupplierLinePricing', () => {
  test('derives the net unit cost from list price and discount', () => {
    expect(deriveSupplierLinePricing(200, 10)).toEqual({
      listPrice: 200,
      discountPercent: 10,
      unitPrice: 180,
    });
  });

  test('rounds more-than-two-decimal inputs to DB scale BEFORE deriving the net cost', () => {
    // 10.005 → 10.01 at NUMERIC(_,2); 10.01 × (1 − 10/100) = 9.009 → 9.01.
    expect(deriveSupplierLinePricing(10.005, 10)).toEqual({
      listPrice: 10.01,
      discountPercent: 10,
      unitPrice: 9.01,
    });
  });

  test('rounds a more-than-two-decimal discount as well', () => {
    // 12.345 → 12.35 at NUMERIC(5,2).
    const pricing = deriveSupplierLinePricing(100, 12.345);
    expect(pricing.discountPercent).toBe(12.35);
    expect(pricing.unitPrice).toBe(roundCurrency(100 * (1 - 12.35 / 100)));
  });

  test('a zero discount leaves the net cost equal to the (rounded) list price', () => {
    expect(deriveSupplierLinePricing(42.5, 0)).toEqual({
      listPrice: 42.5,
      discountPercent: 0,
      unitPrice: 42.5,
    });
  });

  test('a 100% discount yields a zero net cost', () => {
    expect(deriveSupplierLinePricing(99.99, 100)).toEqual({
      listPrice: 99.99,
      discountPercent: 100,
      unitPrice: 0,
    });
  });

  test('the persisted-scale pricing invariant always holds for fuzzed inputs', () => {
    const lists = [0, 0.01, 1.005, 9.999, 10.005, 123.456, 999.995, 100000.555];
    const discounts = [0, 0.5, 1.005, 10, 33.333, 99.995, 100];
    for (const lp of lists) {
      for (const dp of discounts) {
        const p = deriveSupplierLinePricing(lp, dp);
        // unitPrice is exactly re-derivable from the persisted (rounded) listPrice/discountPercent.
        expect(p.unitPrice).toBe(roundCurrency(p.listPrice * (1 - p.discountPercent / 100)));
        // Inputs are stored at NUMERIC(_,2): no more than two decimals survive.
        expect(p.listPrice).toBe(roundCurrency(p.listPrice));
        expect(p.discountPercent).toBe(roundCurrency(p.discountPercent));
        // A non-negative discount ≤ 100 can never produce a negative net cost.
        expect(p.unitPrice).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
