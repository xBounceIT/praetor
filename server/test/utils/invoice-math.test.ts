import { describe, expect, test } from 'bun:test';
import { computeInvoiceTotals } from '../../utils/invoice-math.ts';

describe('computeInvoiceTotals', () => {
  test('empty items → zero subtotal and total', () => {
    expect(computeInvoiceTotals([])).toEqual({ subtotal: 0, total: 0 });
  });

  test('single item with no discount', () => {
    expect(computeInvoiceTotals([{ quantity: 2, unitPrice: 50, discount: 0 }])).toEqual({
      subtotal: 100,
      total: 100,
    });
  });

  test('single item with 10% discount', () => {
    expect(computeInvoiceTotals([{ quantity: 2, unitPrice: 50, discount: 10 }])).toEqual({
      subtotal: 90,
      total: 90,
    });
  });

  test('multiple items sum correctly', () => {
    expect(
      computeInvoiceTotals([
        { quantity: 2, unitPrice: 50, discount: 0 }, // 100
        { quantity: 3, unitPrice: 20, discount: 0 }, // 60
        { quantity: 1, unitPrice: 40, discount: 25 }, // 30
      ]),
    ).toEqual({ subtotal: 190, total: 190 });
  });

  test('100% discount yields 0 line', () => {
    expect(computeInvoiceTotals([{ quantity: 5, unitPrice: 100, discount: 100 }])).toEqual({
      subtotal: 0,
      total: 0,
    });
  });

  test('rounds to 2 decimals', () => {
    // 0.1 * 0.2 = 0.020000000000000004 in JS floats; rounding pins it to 0.02
    expect(computeInvoiceTotals([{ quantity: 0.1, unitPrice: 0.2, discount: 0 }])).toEqual({
      subtotal: 0.02,
      total: 0.02,
    });
  });

  test('rounds halves up', () => {
    // 1 * 0.005 = 0.005 → rounds to 0.01
    expect(computeInvoiceTotals([{ quantity: 1, unitPrice: 0.005, discount: 0 }])).toEqual({
      subtotal: 0.01,
      total: 0.01,
    });
  });

  test('matches frontend formula: quantity * unitPrice * (1 - discount/100)', () => {
    // 7 * 13.50 * 0.85 = 80.325 → rounded to 80.33
    expect(computeInvoiceTotals([{ quantity: 7, unitPrice: 13.5, discount: 15 }])).toEqual({
      subtotal: 80.33,
      total: 80.33,
    });
  });

  test('subtotal equals total (no tax in this codebase)', () => {
    const result = computeInvoiceTotals([{ quantity: 1, unitPrice: 99.99, discount: 0 }]);
    expect(result.subtotal).toBe(result.total);
  });
});
