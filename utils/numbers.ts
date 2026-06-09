import type { DiscountType, DurationUnit, SupplierUnitType } from '../types';

const CURRENCY_DECIMAL_PLACES = 2;

const MONTHS_PER_YEAR = 12;

const shiftDecimal = (value: number, decimalPlaces: number): number => {
  const [coefficient, exponent = '0'] = value.toString().split('e');
  return Number(`${coefficient}e${Number(exponent) + decimalPlaces}`);
};

// Match the NUMERIC(_, 2) precision used by the backend so frontend and backend agree on
// rendered totals. Mirrors `roundCurrency` in `server/utils/invoice-math.ts`.
export const roundCurrency = (value: number): number => {
  if (!Number.isFinite(value)) return value;

  const sign = Math.sign(value);
  if (sign === 0) return 0;

  const cents = Math.round(shiftDecimal(Math.abs(value), CURRENCY_DECIMAL_PLACES));
  if (cents === 0) return 0;

  return sign * shiftDecimal(cents, -CURRENCY_DECIMAL_PLACES);
};

export const parseNumberInputValue = (value: string, fallback: number | undefined = 0) => {
  if (value === '') return fallback;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export const convertUnitPrice = (
  price: number,
  fromType: SupplierUnitType,
  toType: SupplierUnitType,
): number => {
  if (fromType === toType) return price;
  const hourly = fromType === 'days' ? price / 8 : price;
  return toType === 'days' ? hourly * 8 : hourly;
};

export const calcProductSalePrice = (cost: number, molPercentage: number): number => {
  // Guard against ≥100% MOL (would produce ≤0 or negative denominator)
  if (molPercentage >= 100) return cost;
  return cost / (1 - molPercentage / 100);
};

export interface PricingItem {
  unitPrice?: number;
  discount?: number;
  supplierQuoteItemId?: string | null;
  supplierQuoteUnitPrice?: number | null;
  productCost?: number;
  unitType?: SupplierUnitType;
  // Invoices store the line unit as `unitOfMeasure` ('unit' | 'hours') instead of `unitType`.
  // Either field being 'unit' marks a countable line that cannot carry a duration.
  unitOfMeasure?: 'unit' | 'hours';
  quantity?: number;
  productMolPercentage?: number | null;
  // Number of months the line runs (issue #757). Multiplies cost and revenue alongside
  // quantity. Absent/invalid → 1, so items that never set it (offers, orders, invoices)
  // keep their existing totals.
  durationMonths?: number;
  // Display unit for the duration value: 'months' (default) or 'years'. Pricing always uses
  // `durationMonths`; this only affects how the value is rendered/entered in the UI.
  durationUnit?: DurationUnit;
}

export const getEffectiveCost = (item: PricingItem): number => {
  if (item.supplierQuoteItemId) return Number(item.supplierQuoteUnitPrice ?? 0);
  return Number(item.productCost ?? 0);
};

export const getEffectiveMol = (item: PricingItem): number => {
  return item.productMolPercentage ? Number(item.productMolPercentage) : 0;
};

export const getEffectiveDurationMonths = (item: PricingItem): number => {
  // 'N/A' marks a line where duration does not apply, so it never multiplies regardless of the
  // stored months (issue #775).
  if (normalizeDurationUnit(item.durationUnit) === 'na') return 1;
  // Otherwise duration multiplies the line (issue #757) and applies to every unit type; absent or
  // non-positive values fall back to a single month.
  const months = Number(item.durationMonths ?? 1);
  return Number.isFinite(months) && months > 0 ? months : 1;
};

// Coerce an arbitrary value to a valid duration unit, defaulting to 'months' (issue #757).
// 'na' (N/A) marks a line where duration does not apply (issue #775).
export const normalizeDurationUnit = (value: unknown): DurationUnit =>
  value === 'years' ? 'years' : value === 'na' ? 'na' : 'months';

// Convert a value entered in `unit` into canonical whole months ≥ 1. Years are multiplied by 12;
// the result is rounded so the integer `duration_months` column never sees a fractional value.
export const durationValueToMonths = (value: number, unit: DurationUnit): number => {
  const months = unit === 'years' ? value * MONTHS_PER_YEAR : value;
  return Number.isFinite(months) && months > 0 ? Math.round(months) : 1;
};

// The number to show in the duration input for the item's chosen unit. Canonical storage is
// always months; 'years' is derived as months / 12.
export const getDurationDisplayValue = (item: PricingItem): number => {
  const months = getEffectiveDurationMonths(item);
  return normalizeDurationUnit(item.durationUnit) === 'years' ? months / MONTHS_PER_YEAR : months;
};

// Parse a duration-input string (expressed in `unit`) into canonical whole months ≥ 1 (issue
// #757). Empty/invalid input falls back to one of the chosen unit (1 month / 1 year). Shared by
// the quote/offer/order/invoice line-item rows so the parse-and-clamp rule lives in one place.
// Parses with parseFloat (not parseInt): in 'years' a non-multiple of 12 months renders as a
// fractional year (e.g. 18 months → 1.5), and that decimal must survive editing — `durationValueToMonths`
// then folds it back to canonical whole months (1.5 × 12 = 18), so the value round-trips.
export const parseDurationValueToMonths = (value: string, unit: DurationUnit): number => {
  const parsed = Number.parseFloat(value);
  if (value === '' || Number.isNaN(parsed)) return durationValueToMonths(1, unit);
  return durationValueToMonths(Math.max(1, parsed), unit);
};

export interface ItemPricingContext {
  baseCost: number;
  unitCost: number;
  molPercentage: number;
  quantity: number;
  durationMonths: number;
  lineCost: number;
}

export const getItemPricingContext = (
  item: PricingItem,
  defaultUnitType: SupplierUnitType = 'hours',
): ItemPricingContext => {
  const baseCost = getEffectiveCost(item);
  const unitCost = convertUnitPrice(baseCost, 'hours', item.unitType || defaultUnitType);
  const molPercentage = getEffectiveMol(item);
  const quantity = Number(item.quantity || 0);
  const durationMonths = getEffectiveDurationMonths(item);
  const lineCost = unitCost * quantity * durationMonths;
  return { baseCost, unitCost, molPercentage, quantity, durationMonths, lineCost };
};

export interface PricingTotals {
  subtotal: number;
  discountAmount: number;
  total: number;
  totalCost: number;
  margin: number;
  marginPercentage: number;
}

export const calculatePricingTotals = (
  items: PricingItem[],
  globalDiscount: number,
  defaultUnitType: SupplierUnitType = 'hours',
  discountType: DiscountType = 'percentage',
): PricingTotals => {
  let subtotal = 0;
  let totalCost = 0;

  items.forEach((item) => {
    const durationMonths = getEffectiveDurationMonths(item);
    const lineSubtotal = Number(item.quantity || 0) * Number(item.unitPrice || 0) * durationMonths;
    const lineDiscount = (lineSubtotal * (item.discount || 0)) / 100;
    subtotal += lineSubtotal - lineDiscount;

    const cost = getEffectiveCost(item);
    totalCost +=
      Number(item.quantity || 0) *
      convertUnitPrice(cost, 'hours', item.unitType || defaultUnitType) *
      durationMonths;
  });

  const discountAmount =
    discountType === 'currency'
      ? Math.min(Math.max(globalDiscount, 0), subtotal)
      : subtotal * (globalDiscount / 100);
  const total = subtotal - discountAmount;
  const margin = total - totalCost;
  const marginPercentage = total > 0 ? (margin / total) * 100 : 0;

  // Round at the same precision the backend uses so the rendered totals match what gets
  // persisted (NUMERIC(_, 2)). Without this, accumulating floats like 0.1 + 0.2 leak the
  // 0.30000000000000004 representation into the UI while the backend stores 0.30.
  return {
    subtotal: roundCurrency(subtotal),
    discountAmount: roundCurrency(discountAmount),
    total: roundCurrency(total),
    totalCost: roundCurrency(totalCost),
    margin: roundCurrency(margin),
    marginPercentage: roundCurrency(marginPercentage),
  };
};

export const formatDiscountValue = (
  discount: number,
  discountType: DiscountType,
  currency: string,
): string => (discountType === 'currency' ? `${discount} ${currency}` : `${discount}%`);

/**
 * Display precision (decimal places) for MOL / margin percentages. Single source of truth
 * shared by `formatMolPercentage` (read-only labels and list columns) and the editable MOL
 * `ValidatedNumberInput` fields in the quote/offer/order line editors, so the two can never
 * drift apart. Matches the `numeric(5, 2)` scale the value is stored at in the database.
 */
export const MOL_PERCENTAGE_DECIMALS = 2;

/**
 * Render a margin/MOL percentage for display with a fixed two decimals (e.g. "33.33%").
 * Centralizes the precision so the quote, offer and order views stay consistent; the value
 * is already rounded to two decimals upstream by `calculatePricingTotals`.
 */
export const formatMolPercentage = (value: number): string =>
  `${(value || 0).toFixed(MOL_PERCENTAGE_DECIMALS)}%`;
