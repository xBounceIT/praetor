import { describe, expect, test } from 'bun:test';
import {
  calculateClientLineMol,
  withCalculatedClientLineMol,
} from '../../utils/client-line-pricing.ts';

const productLine = (overrides = {}) => ({
  unitPrice: 100,
  productCost: 60,
  productMolPercentage: null,
  supplierQuoteItemId: null,
  supplierQuoteUnitPrice: null,
  unitType: 'hours' as const,
  ...overrides,
});

describe('calculateClientLineMol', () => {
  test('derives MOL from product cost and sale price', () => {
    expect(calculateClientLineMol(productLine())).toBe(40);
  });

  test('does not convert a product cost for a day-labelled line', () => {
    expect(
      calculateClientLineMol(productLine({ unitPrice: 100, productCost: 10, unitType: 'days' })),
    ).toBe(90);
  });

  test('uses the supplier quote cost as already expressed in the line unit', () => {
    expect(
      calculateClientLineMol(
        productLine({
          unitPrice: 100,
          productCost: 10,
          supplierQuoteItemId: 'sqi-1',
          supplierQuoteUnitPrice: 75,
          unitType: 'days',
        }),
      ),
    ).toBe(25);
  });

  test('returns a negative MOL for a below-cost sale', () => {
    expect(calculateClientLineMol(productLine({ unitPrice: 50, productCost: 60 }))).toBe(-20);
  });

  test('returns null when a positive cost has no sale price', () => {
    expect(calculateClientLineMol(productLine({ unitPrice: 0 }))).toBeNull();
  });

  test('returns null for an invalid negative cost', () => {
    expect(calculateClientLineMol(productLine({ productCost: -10 }))).toBeNull();
  });
});

describe('withCalculatedClientLineMol', () => {
  test('replaces a stale submitted MOL and preserves the sale price', () => {
    const line = withCalculatedClientLineMol(
      productLine({ unitPrice: 80, productCost: 60, productMolPercentage: 5 }),
    );
    expect(line.unitPrice).toBe(80);
    expect(line.productMolPercentage).toBe(25);
  });
});
