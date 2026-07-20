import { describe, expect, test } from 'bun:test';
import { roundCurrency, roundToDecimalPlaces } from '../../utils/invoice-math.ts';
import { deriveSupplierLinePricing, MAX_LINE_AMOUNT } from '../../utils/supplier-quote-pricing.ts';

describe('MAX_LINE_AMOUNT', () => {
  test('equals the NUMERIC(15,2) maximum (13 integer digits + 2 decimals)', () => {
    // 10^13 - 0.01 = 9999999999999.99; the next scale-2 value (1e13) overflows the column.
    expect(MAX_LINE_AMOUNT).toBe(9_999_999_999_999.99);
    expect(MAX_LINE_AMOUNT).toBeLessThan(10_000_000_000_000);
  });
});

describe('deriveSupplierLinePricing', () => {
  test('derives the net unit cost from list price and discount', () => {
    expect(deriveSupplierLinePricing(200, 10)).toEqual({
      listPrice: 200,
      discountPercent: 10,
      unitPrice: 180,
    });
  });

  test('rounds inputs to DB scale but retains the derived net cost precision', () => {
    // 10.005 → 10.01 at NUMERIC(_,2); the derived 9.009 keeps its fractional cent.
    expect(deriveSupplierLinePricing(10.005, 10)).toEqual({
      listPrice: 10.01,
      discountPercent: 10,
      unitPrice: 9.009,
    });
  });

  test('rounds a more-than-two-decimal discount as well', () => {
    // 12.345 → 12.35 at NUMERIC(5,2).
    const pricing = deriveSupplierLinePricing(100, 12.345);
    expect(pricing.discountPercent).toBe(12.35);
    expect(pricing.unitPrice).toBe(roundToDecimalPlaces(100 * (1 - 12.35 / 100), 6));
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
        // unitPrice is exactly re-derivable from the persisted (rounded) listPrice/discountPercent
        // without discarding fractional cents.
        expect(p.unitPrice).toBe(
          roundToDecimalPlaces(p.listPrice * (1 - p.discountPercent / 100), 6),
        );
        // Inputs are stored at NUMERIC(_,2): no more than two decimals survive.
        expect(p.listPrice).toBe(roundCurrency(p.listPrice));
        expect(p.discountPercent).toBe(roundCurrency(p.discountPercent));
        // A non-negative discount ≤ 100 can never produce a negative net cost.
        expect(p.unitPrice).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
