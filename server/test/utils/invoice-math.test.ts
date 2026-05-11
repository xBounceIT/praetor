import { describe, expect, test } from 'bun:test';
import { computeInvoiceTotals } from '../../utils/invoice-math.ts';

describe('computeInvoiceTotals', () => {
  test('empty items → zero subtotal, tax, and total', () => {
    expect(computeInvoiceTotals([])).toEqual({ subtotal: 0, tax: 0, total: 0 });
  });

  test('single item with no discount and no tax', () => {
    expect(computeInvoiceTotals([{ quantity: 2, unitPrice: 50, discount: 0 }])).toEqual({
      subtotal: 100,
      tax: 0,
      total: 100,
    });
  });

  test('single item with 10% discount and no tax', () => {
    expect(computeInvoiceTotals([{ quantity: 2, unitPrice: 50, discount: 10 }])).toEqual({
      subtotal: 90,
      tax: 0,
      total: 90,
    });
  });

  test('multiple items sum correctly without tax', () => {
    expect(
      computeInvoiceTotals([
        { quantity: 2, unitPrice: 50, discount: 0 }, // 100
        { quantity: 3, unitPrice: 20, discount: 0 }, // 60
        { quantity: 1, unitPrice: 40, discount: 25 }, // 30
      ]),
    ).toEqual({ subtotal: 190, tax: 0, total: 190 });
  });

  test('100% discount yields 0 line', () => {
    expect(computeInvoiceTotals([{ quantity: 5, unitPrice: 100, discount: 100 }])).toEqual({
      subtotal: 0,
      tax: 0,
      total: 0,
    });
  });

  test('rounds to 2 decimals', () => {
    // 0.1 * 0.2 = 0.020000000000000004 in JS floats; rounding pins it to 0.02
    expect(computeInvoiceTotals([{ quantity: 0.1, unitPrice: 0.2, discount: 0 }])).toEqual({
      subtotal: 0.02,
      tax: 0,
      total: 0.02,
    });
  });

  test('rounds halves up', () => {
    // 1 * 0.005 = 0.005 → rounds to 0.01
    expect(computeInvoiceTotals([{ quantity: 1, unitPrice: 0.005, discount: 0 }])).toEqual({
      subtotal: 0.01,
      tax: 0,
      total: 0.01,
    });
  });

  test('matches frontend formula: quantity * unitPrice * (1 - discount/100)', () => {
    // 7 * 13.50 * 0.85 = 80.325 → rounded to 80.33
    expect(computeInvoiceTotals([{ quantity: 7, unitPrice: 13.5, discount: 15 }])).toEqual({
      subtotal: 80.33,
      tax: 0,
      total: 80.33,
    });
  });

  test('subtotal equals total when no tax provided (backwards compatible)', () => {
    const result = computeInvoiceTotals([{ quantity: 1, unitPrice: 99.99, discount: 0 }]);
    expect(result.subtotal).toBe(result.total);
    expect(result.tax).toBe(0);
  });

  test('regression: applies item-level tax so subtotal !== total', () => {
    // 1 * 100 * 1.0 = 100 subtotal, 22% VAT → 22 tax, 122 total
    const result = computeInvoiceTotals([
      { quantity: 1, unitPrice: 100, discount: 0, taxRate: 22 },
    ]);
    expect(result).toEqual({ subtotal: 100, tax: 22, total: 122 });
    expect(result.subtotal).not.toBe(result.total);
  });

  test('regression: applies tax after item discount', () => {
    // 2 * 50 * (1 - 10/100) = 90 subtotal, 10% tax → 9 tax, 99 total
    const result = computeInvoiceTotals([
      { quantity: 2, unitPrice: 50, discount: 10, taxRate: 10 },
    ]);
    expect(result).toEqual({ subtotal: 90, tax: 9, total: 99 });
    expect(result.subtotal).not.toBe(result.total);
  });

  test('mixes taxed and untaxed lines correctly', () => {
    // Line 1: 100 subtotal, 22 tax (22%)
    // Line 2: 60 subtotal, 0 tax (no rate)
    // Line 3: 30 subtotal, 1.5 tax (5%)
    const result = computeInvoiceTotals([
      { quantity: 2, unitPrice: 50, discount: 0, taxRate: 22 },
      { quantity: 3, unitPrice: 20, discount: 0 },
      { quantity: 1, unitPrice: 40, discount: 25, taxRate: 5 },
    ]);
    expect(result).toEqual({ subtotal: 190, tax: 23.5, total: 213.5 });
  });

  test('tax is rounded to 2 decimals', () => {
    // 1 * 10 * 1.0 = 10 subtotal, 12.345% tax → 1.2345 → rounded 1.23
    const result = computeInvoiceTotals([
      { quantity: 1, unitPrice: 10, discount: 0, taxRate: 12.345 },
    ]);
    expect(result).toEqual({ subtotal: 10, tax: 1.23, total: 11.23 });
  });

  test('zero taxRate behaves like no taxRate', () => {
    const a = computeInvoiceTotals([{ quantity: 1, unitPrice: 100, discount: 0, taxRate: 0 }]);
    const b = computeInvoiceTotals([{ quantity: 1, unitPrice: 100, discount: 0 }]);
    expect(a).toEqual(b);
  });
});
