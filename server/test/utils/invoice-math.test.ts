import { describe, expect, test } from 'bun:test';
import { computeInvoiceTotals, roundCurrency } from '../../utils/invoice-math.ts';

describe('computeInvoiceTotals', () => {
  test('empty items → zero subtotal, taxTotal, and total', () => {
    expect(computeInvoiceTotals([])).toEqual({ subtotal: 0, taxTotal: 0, total: 0 });
  });

  test('single item with no discount and no tax', () => {
    expect(computeInvoiceTotals([{ quantity: 2, unitPrice: 50, discount: 0 }])).toEqual({
      subtotal: 100,
      taxTotal: 0,
      total: 100,
    });
  });

  test('single item with 10% discount and no tax', () => {
    expect(computeInvoiceTotals([{ quantity: 2, unitPrice: 50, discount: 10 }])).toEqual({
      subtotal: 90,
      taxTotal: 0,
      total: 90,
    });
  });

  test('multiple items sum correctly with no tax', () => {
    expect(
      computeInvoiceTotals([
        { quantity: 2, unitPrice: 50, discount: 0 }, // 100
        { quantity: 3, unitPrice: 20, discount: 0 }, // 60
        { quantity: 1, unitPrice: 40, discount: 25 }, // 30
      ]),
    ).toEqual({ subtotal: 190, taxTotal: 0, total: 190 });
  });

  test('100% discount yields 0 line including tax', () => {
    expect(
      computeInvoiceTotals([{ quantity: 5, unitPrice: 100, discount: 100, taxRate: 22 }]),
    ).toEqual({
      subtotal: 0,
      taxTotal: 0,
      total: 0,
    });
  });

  test('rounds to 2 decimals (subtotal)', () => {
    // 0.1 * 0.2 = 0.020000000000000004 in JS floats; rounding pins it to 0.02
    expect(computeInvoiceTotals([{ quantity: 0.1, unitPrice: 0.2, discount: 0 }])).toEqual({
      subtotal: 0.02,
      taxTotal: 0,
      total: 0.02,
    });
  });

  test('rounds halves up', () => {
    // 1 * 0.005 = 0.005 → rounds to 0.01
    expect(computeInvoiceTotals([{ quantity: 1, unitPrice: 0.005, discount: 0 }])).toEqual({
      subtotal: 0.01,
      taxTotal: 0,
      total: 0.01,
    });
  });

  test('matches frontend formula: quantity * unitPrice * (1 - discount/100)', () => {
    // 7 * 13.50 * 0.85 = 80.325 → rounded to 80.33
    expect(computeInvoiceTotals([{ quantity: 7, unitPrice: 13.5, discount: 15 }])).toEqual({
      subtotal: 80.33,
      taxTotal: 0,
      total: 80.33,
    });
  });

  test('Italian standard 22% VAT', () => {
    // taxable 100 * 22% = 22 tax, total 122
    expect(
      computeInvoiceTotals([{ quantity: 2, unitPrice: 50, discount: 0, taxRate: 22 }]),
    ).toEqual({ subtotal: 100, taxTotal: 22, total: 122 });
  });

  test('reduced Italian rates (10%, 5%, 4%) and 0% exempt mix', () => {
    expect(
      computeInvoiceTotals([
        { quantity: 1, unitPrice: 100, discount: 0, taxRate: 22 }, // 100 + 22
        { quantity: 1, unitPrice: 200, discount: 0, taxRate: 10 }, // 200 + 20
        { quantity: 1, unitPrice: 50, discount: 0, taxRate: 4 }, // 50 + 2
        { quantity: 1, unitPrice: 30, discount: 0, taxRate: 0 }, // 30 + 0 (exempt)
      ]),
    ).toEqual({ subtotal: 380, taxTotal: 44, total: 424 });
  });

  test('decimal tax rate (4.5%) still rounds cleanly', () => {
    // 100 * 4.5% = 4.5 → rounded to 4.50
    expect(
      computeInvoiceTotals([{ quantity: 2, unitPrice: 50, discount: 0, taxRate: 4.5 }]),
    ).toEqual({ subtotal: 100, taxTotal: 4.5, total: 104.5 });
  });

  test('tax applies on top of discount (taxable = qty*price*(1-discount/100))', () => {
    // 10 * 100 * 0.9 = 900 taxable; 22% = 198 tax; total 1098
    expect(
      computeInvoiceTotals([{ quantity: 10, unitPrice: 100, discount: 10, taxRate: 22 }]),
    ).toEqual({ subtotal: 900, taxTotal: 198, total: 1098 });
  });

  test('taxRate undefined defaults to 0 (legacy / pre-feature data)', () => {
    expect(computeInvoiceTotals([{ quantity: 1, unitPrice: 99.99, discount: 0 }])).toEqual({
      subtotal: 99.99,
      taxTotal: 0,
      total: 99.99,
    });
  });

  test('missing quantity, unit price, or discount defaults to 0 instead of NaN', () => {
    expect(
      computeInvoiceTotals([
        { quantity: 2, unitPrice: 50 },
        { unitPrice: 50, discount: 0 },
        { quantity: 2, discount: 0 },
      ]),
    ).toEqual({
      subtotal: 100,
      taxTotal: 0,
      total: 100,
    });
  });

  test('total equals subtotal + taxTotal exactly (rounding consistency)', () => {
    const result = computeInvoiceTotals([
      { quantity: 3, unitPrice: 33.33, discount: 0, taxRate: 22 },
    ]);
    expect(result.total).toBe(roundCurrency(result.subtotal + result.taxTotal));
  });
});

describe('roundCurrency', () => {
  test('rounds to 2 decimals', () => {
    expect(roundCurrency(0.1 + 0.2)).toBe(0.3);
  });

  test('rounds halves up', () => {
    expect(roundCurrency(0.005)).toBe(0.01);
  });
});
