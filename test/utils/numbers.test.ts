import { describe, expect, test } from 'bun:test';
import {
  calcProductSalePrice,
  calculatePricingTotals,
  convertUnitPrice,
  formatDiscountValue,
  getEffectiveCost,
  getEffectiveMol,
  getItemPricingContext,
  type PricingItem,
  parseNumberInputValue,
} from '../../utils/numbers';

describe('parseNumberInputValue', () => {
  test('parses a plain numeric string', () => {
    expect(parseNumberInputValue('12.5')).toBe(12.5);
  });

  test('returns 0 (default fallback) for empty string', () => {
    expect(parseNumberInputValue('')).toBe(0);
  });

  test('honors a custom fallback for empty string', () => {
    expect(parseNumberInputValue('', 7)).toBe(7);
  });

  test('returns the custom fallback for non-numeric strings', () => {
    expect(parseNumberInputValue('abc', 5)).toBe(5);
  });

  test('parses negative numbers', () => {
    expect(parseNumberInputValue('-3.14')).toBe(-3.14);
  });
});

describe('convertUnitPrice', () => {
  test('returns input unchanged when from === to', () => {
    expect(convertUnitPrice(100, 'hours', 'hours')).toBe(100);
    expect(convertUnitPrice(100, 'days', 'days')).toBe(100);
  });

  test('converts hours → days by multiplying by 8', () => {
    expect(convertUnitPrice(10, 'hours', 'days')).toBe(80);
  });

  test('converts days → hours by dividing by 8', () => {
    expect(convertUnitPrice(80, 'days', 'hours')).toBe(10);
  });

  test('treats unit and hours as equivalent (both are non-days)', () => {
    expect(convertUnitPrice(50, 'unit', 'hours')).toBe(50);
    expect(convertUnitPrice(50, 'hours', 'unit')).toBe(50);
  });
});

describe('calcProductSalePrice', () => {
  test('returns the cost when MOL is 0', () => {
    expect(calcProductSalePrice(100, 0)).toBe(100);
  });

  test('marks up by the MOL percentage of the SALE price (not cost)', () => {
    // cost / (1 - 0.25) → 133.33...
    expect(calcProductSalePrice(100, 25)).toBeCloseTo(133.333, 3);
  });

  test('returns the cost when MOL is exactly 100% (would be infinity)', () => {
    expect(calcProductSalePrice(100, 100)).toBe(100);
  });

  test('returns the cost when MOL exceeds 100% (would be negative)', () => {
    expect(calcProductSalePrice(100, 150)).toBe(100);
  });
});

describe('getEffectiveCost / getEffectiveMol', () => {
  test('uses supplierQuoteUnitPrice when supplierQuoteItemId is set', () => {
    expect(getEffectiveCost({ supplierQuoteItemId: 'q1', supplierQuoteUnitPrice: 9 })).toBe(9);
  });

  test('falls back to productCost when no supplier quote is referenced', () => {
    expect(getEffectiveCost({ productCost: 7 })).toBe(7);
  });

  test('returns 0 when supplierQuoteUnitPrice is null on a quote-linked item', () => {
    expect(getEffectiveCost({ supplierQuoteItemId: 'q1', supplierQuoteUnitPrice: null })).toBe(0);
  });

  test('returns 0 when both supplier quote and productCost are absent', () => {
    expect(getEffectiveCost({})).toBe(0);
  });

  test('getEffectiveMol returns 0 when productMolPercentage is null/undefined', () => {
    expect(getEffectiveMol({})).toBe(0);
    expect(getEffectiveMol({ productMolPercentage: null })).toBe(0);
  });

  test('getEffectiveMol returns the numeric value when set', () => {
    expect(getEffectiveMol({ productMolPercentage: 25 })).toBe(25);
  });
});

describe('getItemPricingContext', () => {
  test('computes line cost in the item unitType when explicit', () => {
    const item: PricingItem = { productCost: 80, unitType: 'days', quantity: 2 };
    const ctx = getItemPricingContext(item);
    expect(ctx.baseCost).toBe(80);
    expect(ctx.unitCost).toBe(640); // 80/h × 8 = 640/day
    expect(ctx.quantity).toBe(2);
    expect(ctx.lineCost).toBe(1280);
  });

  test('falls back to defaultUnitType when item has no unitType', () => {
    const item: PricingItem = { productCost: 50, quantity: 3 };
    const ctx = getItemPricingContext(item, 'hours');
    expect(ctx.unitCost).toBe(50);
    expect(ctx.lineCost).toBe(150);
  });

  test('reports MOL via getEffectiveMol', () => {
    const item: PricingItem = { productCost: 50, productMolPercentage: 30 };
    expect(getItemPricingContext(item).molPercentage).toBe(30);
  });
});

describe('calculatePricingTotals', () => {
  test('computes totals for a simple single-item invoice', () => {
    const items: PricingItem[] = [{ unitPrice: 100, quantity: 2, productCost: 60 }];
    const t = calculatePricingTotals(items, 0);
    expect(t.subtotal).toBe(200);
    expect(t.totalCost).toBe(120);
    expect(t.discountAmount).toBe(0);
    expect(t.total).toBe(200);
    expect(t.margin).toBe(80);
    expect(t.marginPercentage).toBe(40);
  });

  test('applies a per-line percentage discount', () => {
    const items: PricingItem[] = [{ unitPrice: 100, quantity: 1, discount: 10 }];
    expect(calculatePricingTotals(items, 0).subtotal).toBe(90);
  });

  test('applies a global percentage discount on top of per-line discounts', () => {
    const items: PricingItem[] = [{ unitPrice: 100, quantity: 1, discount: 10 }];
    const t = calculatePricingTotals(items, 50, 'hours', 'percentage');
    expect(t.subtotal).toBe(90);
    expect(t.discountAmount).toBe(45);
    expect(t.total).toBe(45);
  });

  test('caps a currency-type global discount at the subtotal (no negative totals)', () => {
    const items: PricingItem[] = [{ unitPrice: 50, quantity: 1 }];
    const t = calculatePricingTotals(items, 999, 'hours', 'currency');
    expect(t.discountAmount).toBe(50);
    expect(t.total).toBe(0);
  });

  test('clamps a negative currency discount to 0', () => {
    const items: PricingItem[] = [{ unitPrice: 50, quantity: 1 }];
    const t = calculatePricingTotals(items, -10, 'hours', 'currency');
    expect(t.discountAmount).toBe(0);
    expect(t.total).toBe(50);
  });

  test('reports 0 marginPercentage when total is 0 (avoids division-by-zero)', () => {
    const items: PricingItem[] = [{ unitPrice: 0, quantity: 1, productCost: 0 }];
    expect(calculatePricingTotals(items, 0).marginPercentage).toBe(0);
  });

  test('uses supplier quote unit price for cost when item is linked to a quote', () => {
    const items: PricingItem[] = [
      {
        unitPrice: 200,
        quantity: 1,
        supplierQuoteItemId: 'q1',
        supplierQuoteUnitPrice: 80,
        productCost: 5, // ignored because the item is quote-linked
      },
    ];
    const t = calculatePricingTotals(items, 0);
    expect(t.totalCost).toBe(80);
    expect(t.margin).toBe(120);
  });

  test('respects per-item unitType when computing cost (days vs hours)', () => {
    const items: PricingItem[] = [
      { unitPrice: 1000, quantity: 1, productCost: 50, unitType: 'days' },
    ];
    expect(calculatePricingTotals(items, 0).totalCost).toBe(400); // 50/h × 8 = 400/day
  });

  test('handles an empty item list', () => {
    const t = calculatePricingTotals([], 0);
    expect(t.subtotal).toBe(0);
    expect(t.total).toBe(0);
    expect(t.margin).toBe(0);
    expect(t.marginPercentage).toBe(0);
  });
});

describe('formatDiscountValue', () => {
  test('renders percentage with a "%" suffix', () => {
    expect(formatDiscountValue(10, 'percentage', 'EUR')).toBe('10%');
  });

  test('renders currency with a " <currency>" suffix', () => {
    expect(formatDiscountValue(50, 'currency', 'EUR')).toBe('50 EUR');
  });
});
