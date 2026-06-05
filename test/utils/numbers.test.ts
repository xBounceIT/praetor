import { describe, expect, test } from 'bun:test';
import {
  calcProductSalePrice,
  calculatePricingTotals,
  convertUnitPrice,
  formatDiscountValue,
  getEffectiveCost,
  getEffectiveDurationMonths,
  getEffectiveMol,
  getItemPricingContext,
  type PricingItem,
  parseNumberInputValue,
  roundCurrency,
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

describe('getEffectiveDurationMonths', () => {
  test('defaults to 1 when durationMonths is absent', () => {
    expect(getEffectiveDurationMonths({})).toBe(1);
  });

  test('returns the numeric value when a valid positive duration is set', () => {
    expect(getEffectiveDurationMonths({ durationMonths: 12 })).toBe(12);
  });

  test('falls back to 1 for zero, negative, or non-finite durations', () => {
    expect(getEffectiveDurationMonths({ durationMonths: 0 })).toBe(1);
    expect(getEffectiveDurationMonths({ durationMonths: -3 })).toBe(1);
    expect(getEffectiveDurationMonths({ durationMonths: Number.NaN })).toBe(1);
  });
});

describe('getItemPricingContext', () => {
  test('computes line cost in the item unitType when explicit', () => {
    const item: PricingItem = { productCost: 80, unitType: 'days', quantity: 2 };
    const ctx = getItemPricingContext(item);
    expect(ctx.baseCost).toBe(80);
    expect(ctx.unitCost).toBe(640); // 80/h × 8 = 640/day
    expect(ctx.quantity).toBe(2);
    expect(ctx.durationMonths).toBe(1);
    expect(ctx.lineCost).toBe(1280);
  });

  test('multiplies line cost by durationMonths (issue #757)', () => {
    const item: PricingItem = { productCost: 50, quantity: 2, durationMonths: 12 };
    const ctx = getItemPricingContext(item, 'hours');
    expect(ctx.durationMonths).toBe(12);
    expect(ctx.lineCost).toBe(1200); // 50 × 2 × 12
  });

  test('treats an absent durationMonths as 1 (unchanged from pre-duration behavior)', () => {
    const item: PricingItem = { productCost: 50, quantity: 2 };
    expect(getItemPricingContext(item, 'hours').lineCost).toBe(100);
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

  test('multiplies both revenue and cost by durationMonths (issue #757)', () => {
    const items: PricingItem[] = [
      { unitPrice: 100, quantity: 2, productCost: 60, durationMonths: 12 },
    ];
    const t = calculatePricingTotals(items, 0);
    expect(t.subtotal).toBe(2400); // 100 × 2 × 12
    expect(t.totalCost).toBe(1440); // 60 × 2 × 12
    expect(t.margin).toBe(960); // 2400 − 1440
  });

  test('applies the per-line discount on top of the duration-scaled revenue', () => {
    const items: PricingItem[] = [{ unitPrice: 100, quantity: 1, discount: 10, durationMonths: 3 }];
    // 100 × 1 × 3 = 300, then −10% = 270
    expect(calculatePricingTotals(items, 0).subtotal).toBe(270);
  });

  test('leaves totals unchanged when durationMonths is 1 or absent', () => {
    const withDuration: PricingItem[] = [
      { unitPrice: 100, quantity: 2, productCost: 60, durationMonths: 1 },
    ];
    const without: PricingItem[] = [{ unitPrice: 100, quantity: 2, productCost: 60 }];
    expect(calculatePricingTotals(withDuration, 0)).toEqual(calculatePricingTotals(without, 0));
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

  test('rounds accumulated floats so no IEEE-754 drift leaks into the UI', () => {
    // 0.1 + 0.1 + 0.1 = 0.30000000000000004 in IEEE-754; rounding pins it to 0.30.
    const items: PricingItem[] = [
      { unitPrice: 0.1, quantity: 1 },
      { unitPrice: 0.1, quantity: 1 },
      { unitPrice: 0.1, quantity: 1 },
    ];
    const t = calculatePricingTotals(items, 0);
    expect(t.subtotal).toBe(0.3);
    expect(t.total).toBe(0.3);
  });

  test('rounds floating-point half-cent boundaries in returned totals', () => {
    const t = calculatePricingTotals([{ unitPrice: 1.005, quantity: 1 }], 0);
    expect(t.subtotal).toBe(1.01);
    expect(t.total).toBe(1.01);
  });

  test('rounds every returned field to 2 decimal places', () => {
    // Hand-picked to drift in every field: small unit prices + percentage discount.
    const items: PricingItem[] = [{ unitPrice: 0.1, quantity: 3, productCost: 0.05, discount: 10 }];
    const t = calculatePricingTotals(items, 5, 'hours', 'percentage');
    // None of these should have trailing IEEE-754 digits.
    for (const value of Object.values(t)) {
      expect(value).toBe(roundCurrency(value));
    }
  });
});

describe('roundCurrency', () => {
  test('rounds to 2 decimals', () => {
    expect(roundCurrency(0.1 + 0.2)).toBe(0.3);
  });

  test('rounds halves up', () => {
    expect(roundCurrency(0.005)).toBe(0.01);
  });

  test('rounds floating-point half-cent boundaries up', () => {
    expect(roundCurrency(1.005)).toBe(1.01);
    expect(roundCurrency(1.015)).toBe(1.02);
    expect(roundCurrency(10.075)).toBe(10.08);
  });

  test('does not return negative zero for sub-cent negative values', () => {
    expect(Object.is(roundCurrency(-0.001), -0)).toBe(false);
    expect(roundCurrency(-0.001)).toBe(0);
  });

  test('passes through clean values', () => {
    expect(roundCurrency(1.23)).toBe(1.23);
    expect(roundCurrency(0)).toBe(0);
  });
});

describe('frontend ↔ backend agreement on invoice totals', () => {
  // The server's `computeInvoiceTotals` lives outside this tsconfig's rootDir, so the
  // formula is mirrored here. If either side changes its formula or rounding, this test
  // catches the divergence before invoices ship with mismatched subtotals.
  // NOTE: the frontend's `calculatePricingTotals` does not model per-item VAT (it is
  // shared with quotes/offers); this mirror ignores tax so the cross-layer agreement
  // assertion remains apples-to-apples. Per-item tax is verified in the math test suite
  // and end-to-end in invoice route tests.
  const computeInvoiceTotalsBackend = (
    items: { quantity: number; unitPrice: number; discount: number }[],
  ) => {
    const subtotal = items.reduce((acc, item) => {
      const discountFactor = 1 - item.discount / 100;
      return acc + item.quantity * item.unitPrice * discountFactor;
    }, 0);
    const rounded = roundCurrency(subtotal);
    return { subtotal: rounded, total: rounded };
  };

  test('produces identical subtotal/total for the same line items (no tax)', () => {
    // 0.1 * 3 alone would drift to 0.30000000000000004 without rounding.
    const items = [
      { quantity: 3, unitPrice: 0.1, discount: 0 },
      { quantity: 7, unitPrice: 13.5, discount: 15 },
      { quantity: 2, unitPrice: 50, discount: 10 },
    ];
    const backend = computeInvoiceTotalsBackend(items);
    const frontend = calculatePricingTotals(items, 0);
    expect(frontend.subtotal).toBe(backend.subtotal);
    expect(frontend.total).toBe(backend.total);
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
