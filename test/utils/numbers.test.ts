import { describe, expect, test } from 'bun:test';
import {
  calcProductMolPercentage,
  calcProductSalePrice,
  calculatePricingTotals,
  convertUnitPrice,
  durationValueToMonths,
  formatDecimal,
  formatDiscountValue,
  formatMolPercentage,
  formatNumber,
  getDiscountedLineTotal,
  getDiscountedUnitPrice,
  getDurationDisplayValue,
  getDurationInputValue,
  getEffectiveCost,
  getEffectiveDurationMonths,
  getEffectiveMol,
  getItemPricingContext,
  isFiniteNumber,
  isPositiveFiniteNumber,
  normalizeDurationForSubmit,
  normalizeDurationUnit,
  normalizeLocalizedNumber,
  type PricingItem,
  parseDurationValueToMonths,
  parseNumberInputValue,
  parseOptionalNumberInputValue,
  roundCurrency,
} from '../../utils/numbers';

describe('getDiscountedUnitPrice', () => {
  test('rounds the discounted unit price for currency-scale display', () => {
    expect(getDiscountedUnitPrice(10.01, 10)).toBe(9.01);
  });

  test('handles the inclusive percentage boundaries', () => {
    expect(getDiscountedUnitPrice(10, 0)).toBe(10);
    expect(getDiscountedUnitPrice(10, 100)).toBe(0);
  });
});

describe('getDiscountedLineTotal', () => {
  test('keeps fractional cents until quantity and duration have been applied', () => {
    expect(
      getDiscountedLineTotal({
        unitPrice: 37.75,
        discount: 15,
        quantity: 150,
        durationMonths: 1,
      }),
    ).toBe(4813.125);
  });

  test('uses currency-rounded net units only for migrated historical document lines', () => {
    const item = {
      unitPrice: 37.75,
      discount: 15,
      quantity: 150,
      durationMonths: 1,
    };

    expect(getDiscountedLineTotal({ ...item, legacyDiscountRounding: true })).toBeCloseTo(4813.5);
    expect(getDiscountedLineTotal({ ...item, legacyDiscountRounding: false })).toBe(4813.125);
  });

  test('caps invalid line discounts at 100 percent', () => {
    expect(getDiscountedLineTotal({ unitPrice: 100, quantity: 1, discount: 120 })).toBe(0);
  });
});

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

describe('parseOptionalNumberInputValue', () => {
  test('preserves empty and invalid input instead of defaulting it to zero', () => {
    expect(parseOptionalNumberInputValue('')).toBeUndefined();
    expect(parseOptionalNumberInputValue('abc')).toBeUndefined();
  });

  test('parses a real localized numeric value, including zero', () => {
    expect(parseOptionalNumberInputValue('12,5')).toBe(12.5);
    expect(parseOptionalNumberInputValue('0')).toBe(0);
  });
});

describe('required numeric values', () => {
  test('accepts only finite numbers and finite positive quantities', () => {
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(Number.NaN)).toBe(false);
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isFiniteNumber('1')).toBe(false);

    expect(isPositiveFiniteNumber(1)).toBe(true);
    expect(isPositiveFiniteNumber(0)).toBe(false);
    expect(isPositiveFiniteNumber(-1)).toBe(false);
    expect(isPositiveFiniteNumber(Number.NaN)).toBe(false);
  });
});

describe('localized number formatting', () => {
  test('parses comma decimals and Italian thousands separators', () => {
    expect(parseNumberInputValue('12,5')).toBe(12.5);
    expect(parseNumberInputValue('1.234,56')).toBe(1234.56);
    expect(normalizeLocalizedNumber('1.234,56')).toBe('1234.56');
  });

  test('groups four-digit thousands even on runtimes that default to min2 grouping', () => {
    const NativeNumberFormat = Intl.NumberFormat;
    const Min2NumberFormat = function (
      locales?: Intl.LocalesArgument,
      options: Intl.NumberFormatOptions = {},
    ) {
      return new NativeNumberFormat(locales, {
        ...options,
        useGrouping: options.useGrouping ?? 'min2',
      });
    } as typeof Intl.NumberFormat;
    Min2NumberFormat.supportedLocalesOf = NativeNumberFormat.supportedLocalesOf;
    Intl.NumberFormat = Min2NumberFormat;

    try {
      expect(formatNumber(7000, { numberingSystem: 'latn' })).toBe('7.000');
    } finally {
      Intl.NumberFormat = NativeNumberFormat;
    }
  });

  test('uses commas for decimals and dots only for thousands', () => {
    expect(formatDecimal(1234.5)).toBe('1.234,50');
    expect(formatNumber(1234567.89, { maximumFractionDigits: 2 })).toBe('1.234.567,89');
    expect(formatNumber(7000, { useGrouping: false })).toBe('7000');
  });

  test('never exposes NaN or Infinity in the UI', () => {
    expect(formatDecimal(Number.NaN)).toBe('0,00');
    expect(formatDecimal(Number.POSITIVE_INFINITY)).toBe('0,00');
  });

  test('does not expose negative zero after rounding or calculations', () => {
    expect(formatDecimal(-0)).toBe('0,00');
    expect(formatNumber(-0, { maximumFractionDigits: 0 })).toBe('0');
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

describe('calcProductMolPercentage', () => {
  test('derives MOL as a percentage of the sale price and rounds it to snapshot precision', () => {
    expect(calcProductMolPercentage(60, 80)).toBe(25);
    expect(calcProductMolPercentage(100, 123.45)).toBe(19);
  });

  test('keeps below-cost sales visible as a negative MOL', () => {
    expect(calcProductMolPercentage(120, 100)).toBe(-20);
  });

  test('returns null when a positive cost has no sale price', () => {
    expect(calcProductMolPercentage(50, 0)).toBeNull();
  });

  test('returns null for an invalid negative cost', () => {
    expect(calcProductMolPercentage(-10, 100)).toBeNull();
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

  test('uses the stored duration for every unit type (issue #757)', () => {
    // Duration applies to all line types; the unit never forces it to a single month.
    expect(getEffectiveDurationMonths({ unitType: 'unit', durationMonths: 12 })).toBe(12);
    expect(getEffectiveDurationMonths({ unitOfMeasure: 'unit', durationMonths: 12 })).toBe(12);
    expect(getEffectiveDurationMonths({ unitType: 'hours', durationMonths: 12 })).toBe(12);
    expect(getEffectiveDurationMonths({ unitType: 'days', durationMonths: 6 })).toBe(6);
  });

  test("returns 1 for an 'N/A' line, ignoring any stored durationMonths (issue #775)", () => {
    // 'na' marks a line where duration does not apply, so it never multiplies.
    expect(getEffectiveDurationMonths({ durationUnit: 'na', durationMonths: 6 })).toBe(1);
    expect(getEffectiveDurationMonths({ durationUnit: 'na', durationMonths: 24 })).toBe(1);
  });
});

describe('normalizeDurationUnit', () => {
  test("returns 'years' only when the value is exactly 'years'", () => {
    expect(normalizeDurationUnit('years')).toBe('years');
  });

  test("defaults to 'months' for 'months', unknown strings, and nullish values", () => {
    expect(normalizeDurationUnit('months')).toBe('months');
    expect(normalizeDurationUnit('weeks')).toBe('months');
    expect(normalizeDurationUnit('')).toBe('months');
    expect(normalizeDurationUnit(undefined)).toBe('months');
    expect(normalizeDurationUnit(null)).toBe('months');
    expect(normalizeDurationUnit(12)).toBe('months');
  });

  test("returns 'na' for the literal 'na' (issue #775)", () => {
    expect(normalizeDurationUnit('na')).toBe('na');
  });
});

describe('durationValueToMonths', () => {
  test('passes months through unchanged (rounded to a whole month)', () => {
    expect(durationValueToMonths(3, 'months')).toBe(3);
    expect(durationValueToMonths(2.4, 'months')).toBe(2);
  });

  test('multiplies years by 12 to get canonical months', () => {
    expect(durationValueToMonths(2, 'years')).toBe(24);
    expect(durationValueToMonths(1, 'years')).toBe(12);
    // 1.5 years × 12 = 18 months.
    expect(durationValueToMonths(1.5, 'years')).toBe(18);
  });

  test('falls back to 1 month for zero, negative, or non-finite values', () => {
    expect(durationValueToMonths(0, 'months')).toBe(1);
    expect(durationValueToMonths(-3, 'years')).toBe(1);
    expect(durationValueToMonths(Number.NaN, 'years')).toBe(1);
    expect(durationValueToMonths(Number.POSITIVE_INFINITY, 'months')).toBe(1);
  });
});

describe('getDurationDisplayValue', () => {
  test('shows the raw months when the unit is months (or defaulted)', () => {
    expect(getDurationDisplayValue({ durationMonths: 6, durationUnit: 'months' })).toBe(6);
    // Absent unit defaults to months.
    expect(getDurationDisplayValue({ durationMonths: 6 })).toBe(6);
  });

  test('shows months / 12 when the unit is years', () => {
    expect(getDurationDisplayValue({ durationMonths: 24, durationUnit: 'years' })).toBe(2);
    expect(getDurationDisplayValue({ durationMonths: 12, durationUnit: 'years' })).toBe(1);
  });

  test('clamps an absent/invalid durationMonths to 1 before converting', () => {
    // getEffectiveDurationMonths floors invalid durations to 1, so years shows 1/12.
    expect(getDurationDisplayValue({ durationUnit: 'months' })).toBe(1);
    expect(getDurationDisplayValue({ durationMonths: 0, durationUnit: 'years' })).toBe(1 / 12);
  });

  test("shows the neutral 1 for an 'N/A' line (issue #775)", () => {
    // 'na' never multiplies, so the (disabled) input reads 1 regardless of the stored months.
    expect(getDurationDisplayValue({ durationMonths: 6, durationUnit: 'na' })).toBe(1);
  });
});

describe('getDurationInputValue', () => {
  test('preserves an unfilled or invalid duration for placeholder-only inputs', () => {
    expect(getDurationInputValue({ durationUnit: 'months' })).toBeUndefined();
    expect(getDurationInputValue({ durationMonths: Number.NaN })).toBeUndefined();
    expect(getDurationInputValue({ durationMonths: 0 })).toBeUndefined();
  });

  test('converts real stored durations into their selected display unit', () => {
    expect(getDurationInputValue({ durationMonths: 6, durationUnit: 'months' })).toBe(6);
    expect(getDurationInputValue({ durationMonths: 24, durationUnit: 'years' })).toBe(2);
  });
});

describe('normalizeDurationForSubmit', () => {
  test('keeps blank durations empty and normalizes their display unit to months', () => {
    expect(normalizeDurationForSubmit({ durationUnit: 'years' })).toEqual({
      durationMonths: undefined,
      durationUnit: 'months',
    });
    expect(
      normalizeDurationForSubmit({ durationMonths: Number.NaN, durationUnit: 'years' }),
    ).toEqual({
      durationMonths: undefined,
      durationUnit: 'months',
    });
  });

  test('preserves real and explicitly duration-less values', () => {
    expect(normalizeDurationForSubmit({ durationMonths: 24, durationUnit: 'years' })).toEqual({
      durationMonths: 24,
      durationUnit: 'years',
    });
    expect(normalizeDurationForSubmit({ durationUnit: 'na' })).toEqual({
      durationMonths: undefined,
      durationUnit: 'na',
    });
  });
});

describe('parseDurationValueToMonths', () => {
  test('parses a months input string into whole months', () => {
    expect(parseDurationValueToMonths('3', 'months')).toBe(3);
    expect(parseDurationValueToMonths('12', 'months')).toBe(12);
  });

  test('parses a years input string into canonical months (× 12)', () => {
    expect(parseDurationValueToMonths('2', 'years')).toBe(24);
    expect(parseDurationValueToMonths('1', 'years')).toBe(12);
  });

  test('clamps a sub-1 value up to 1 of the chosen unit', () => {
    expect(parseDurationValueToMonths('0', 'months')).toBe(1);
    expect(parseDurationValueToMonths('-4', 'months')).toBe(1);
    // 1 year, not 1 month, when the unit is years.
    expect(parseDurationValueToMonths('0', 'years')).toBe(12);
  });

  test('falls back to 1 of the chosen unit for empty or non-numeric input', () => {
    expect(parseDurationValueToMonths('', 'months')).toBe(1);
    expect(parseDurationValueToMonths('abc', 'months')).toBe(1);
    // Empty/invalid input under years means one year = 12 months.
    expect(parseDurationValueToMonths('', 'years')).toBe(12);
    expect(parseDurationValueToMonths('abc', 'years')).toBe(12);
  });

  test('round-trips a fractional year (non-multiple of 12 months) without truncating', () => {
    // 18 months displays as 1.5 years; editing that decimal must save 18 months, not 12.
    expect(parseDurationValueToMonths('1.5', 'years')).toBe(18);
    expect(getDurationDisplayValue({ durationUnit: 'years', durationMonths: 18 })).toBe(1.5);
    expect(parseDurationValueToMonths('2.5', 'years')).toBe(30);
    // Fractional months round to the nearest whole month (the canonical integer column).
    expect(parseDurationValueToMonths('1.5', 'months')).toBe(2);
    expect(parseDurationValueToMonths('1,5', 'years')).toBe(18);
  });
});

describe('pricing helpers ignore durationUnit and multiply by canonical durationMonths (issue #757)', () => {
  test('getItemPricingContext scales line cost by durationMonths regardless of the display unit', () => {
    const monthsItem: PricingItem = {
      productCost: 50,
      quantity: 2,
      durationMonths: 24,
      durationUnit: 'months',
    };
    const yearsItem: PricingItem = { ...monthsItem, durationUnit: 'years' };

    // Both report 24 canonical months and the same line cost (50 × 2 × 24 = 2400).
    expect(getItemPricingContext(monthsItem, 'hours').durationMonths).toBe(24);
    expect(getItemPricingContext(yearsItem, 'hours').durationMonths).toBe(24);
    expect(getItemPricingContext(yearsItem, 'hours').lineCost).toBe(2400);
    expect(getItemPricingContext(yearsItem, 'hours').lineCost).toBe(
      getItemPricingContext(monthsItem, 'hours').lineCost,
    );
  });

  test('calculatePricingTotals produces identical totals for months vs years display units', () => {
    const monthsItems: PricingItem[] = [
      { unitPrice: 100, quantity: 2, productCost: 60, durationMonths: 24, durationUnit: 'months' },
    ];
    const yearsItems: PricingItem[] = [{ ...monthsItems[0], durationUnit: 'years' }];

    const monthsTotals = calculatePricingTotals(monthsItems, 0);
    const yearsTotals = calculatePricingTotals(yearsItems, 0);

    // Revenue 100 × 2 × 24 = 4800; cost 60 × 2 × 24 = 2880; margin 1920 — same for both units.
    expect(yearsTotals.subtotal).toBe(4800);
    expect(yearsTotals.totalCost).toBe(2880);
    expect(yearsTotals.margin).toBe(1920);
    expect(yearsTotals).toEqual(monthsTotals);
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

  test('reports discount-adjusted line revenue and margin', () => {
    const item: PricingItem = {
      unitPrice: 100,
      quantity: 2,
      productCost: 30,
      discount: 10,
      durationMonths: 3,
    };

    const ctx = getItemPricingContext(item);
    expect(ctx.grossRevenue).toBe(600);
    expect(ctx.discountPercentage).toBe(10);
    expect(ctx.lineDiscount).toBe(60);
    expect(ctx.netRevenue).toBe(540);
    expect(ctx.lineCost).toBe(180);
    expect(ctx.lineMargin).toBe(360);
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
    expect(t.grossSubtotal).toBe(200);
    expect(t.subtotal).toBe(200);
    expect(t.totalCost).toBe(120);
    expect(t.discountAmount).toBe(0);
    expect(t.totalDiscountAmount).toBe(0);
    expect(t.totalDiscountPercentage).toBe(0);
    expect(t.total).toBe(200);
    expect(t.margin).toBe(80);
    expect(t.marginPercentage).toBe(40);
  });

  test('applies a per-line percentage discount', () => {
    const items: PricingItem[] = [{ unitPrice: 100, quantity: 1, discount: 10 }];
    const totals = calculatePricingTotals(items, 0);
    expect(totals.grossSubtotal).toBe(100);
    expect(totals.subtotal).toBe(90);
    expect(totals.totalDiscountAmount).toBe(10);
  });

  test('allows a 100% line discount without making revenue negative', () => {
    const items: PricingItem[] = [{ unitPrice: 100, quantity: 1, productCost: 40, discount: 100 }];
    const totals = calculatePricingTotals(items, 0);
    expect(totals.subtotal).toBe(0);
    expect(totals.total).toBe(0);
    expect(totals.totalCost).toBe(40);
    expect(totals.margin).toBe(-40);
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

  test("an 'N/A' line never multiplies by duration, even with a stored durationMonths (issue #775)", () => {
    const naItems: PricingItem[] = [
      { unitPrice: 100, quantity: 2, productCost: 60, durationMonths: 12, durationUnit: 'na' },
    ];
    const t = calculatePricingTotals(naItems, 0);
    // Revenue 100 × 2 = 200 (not ×12); cost 60 × 2 = 120; margin 80.
    expect(t.subtotal).toBe(200);
    expect(t.totalCost).toBe(120);
    expect(t.margin).toBe(80);
  });

  test('applies a global percentage discount on top of per-line discounts', () => {
    const items: PricingItem[] = [{ unitPrice: 100, quantity: 1, discount: 10 }];
    const t = calculatePricingTotals(items, 50, 'hours', 'percentage');
    expect(t.subtotal).toBe(90);
    expect(t.discountAmount).toBe(45);
    expect(t.totalDiscountAmount).toBe(55);
    expect(t.totalDiscountPercentage).toBe(55);
    expect(t.total).toBe(45);
  });

  test('caps a percentage global discount at 100% so totals cannot become negative', () => {
    const items: PricingItem[] = [{ unitPrice: 50, quantity: 1 }];
    const t = calculatePricingTotals(items, 150, 'hours', 'percentage');
    expect(t.discountAmount).toBe(50);
    expect(t.total).toBe(0);
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

  test('does NOT convert a supplier-sourced days cost (already in the line unit, #812 round 19)', () => {
    // supplierQuoteUnitPrice mirrors the supplier item, whose unit the line copies on
    // pick/refresh — only product costs are hourly-canonical. The old hours→days conversion
    // inflated a days-priced sourced cost by 8 in totals and margins.
    const items: PricingItem[] = [
      {
        unitPrice: 1000,
        quantity: 1,
        supplierQuoteItemId: 'q1',
        supplierQuoteUnitPrice: 400,
        unitType: 'days',
      },
    ];
    const t = calculatePricingTotals(items, 0);
    expect(t.totalCost).toBe(400); // NOT 3200
    expect(t.margin).toBe(600);
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

  test('rounds the aggregate discount from unrounded pricing amounts', () => {
    const t = calculatePricingTotals([{ unitPrice: 0.03, quantity: 1 }], 50);
    expect(t.discountAmount).toBe(0.02);
    expect(t.totalDiscountAmount).toBe(0.02);
    expect(t.totalDiscountPercentage).toBe(50);
    expect(t.total).toBe(0.02);
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

describe('formatMolPercentage', () => {
  test('always renders two decimals with a "%" suffix (issue #780)', () => {
    expect(formatMolPercentage(33.33)).toBe('33,33%');
    // One-significant-decimal and whole numbers pad to two decimals.
    expect(formatMolPercentage(12.5)).toBe('12,50%');
    expect(formatMolPercentage(40)).toBe('40,00%');
  });

  test('renders zero and negative margins', () => {
    expect(formatMolPercentage(0)).toBe('0,00%');
    expect(formatMolPercentage(-15.5)).toBe('-15,50%');
  });

  test('coerces a missing value to 0.00%', () => {
    expect(formatMolPercentage(undefined as unknown as number)).toBe('0,00%');
    expect(formatMolPercentage(Number.NaN)).toBe('0,00%');
  });
});
