import type {
  DiscountType,
  DurationUnit,
  PricingSemanticsVersion,
  SupplierUnitType,
} from '../types';

const CURRENCY_DECIMAL_PLACES = 2;

/**
 * Display precision for MOL / margin percentages, aligned with the database's numeric(5, 2)
 * scale and shared by editable fields and read-only labels.
 */
export const MOL_PERCENTAGE_DECIMALS = 2;

/**
 * Highest valid MOL: as a margin over revenue, 100% would make the sale-price denominator zero.
 */
export const MAX_MOL_PERCENTAGE = 99.99;

/**
 * Lowest MOL supported by the document snapshot columns (`numeric(5, 2)`). A negative MOL is
 * meaningful: it makes a below-cost sale immediately visible instead of hiding the loss as 0%.
 */
export const MIN_MOL_PERCENTAGE = -999.99;

export const NUMBER_LOCALE = 'it-IT';

const MONTHS_PER_YEAR = 12;
const LEGACY_PRICING_SEMANTICS_VERSION = 1;

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

/**
 * Convert a localized user-entered number to the canonical dot-decimal representation used by
 * JavaScript and the API. A dot is treated as a thousands separator when a comma is present.
 */
export const normalizeLocalizedNumber = (value: string): string => {
  const trimmed = value.trim();
  return trimmed.includes(',') ? trimmed.replaceAll('.', '').replace(',', '.') : trimmed;
};

export const parseNumberInputValue = (value: string, fallback: number | undefined = 0) => {
  if (value === '') return fallback;
  const parsed = Number.parseFloat(normalizeLocalizedNumber(value));
  return Number.isNaN(parsed) ? fallback : parsed;
};

export const parseOptionalNumberInputValue = (value: string): number | undefined => {
  if (value === '') return undefined;
  const parsed = Number.parseFloat(normalizeLocalizedNumber(value));
  return Number.isNaN(parsed) ? undefined : parsed;
};

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const isPositiveFiniteNumber = (value: unknown): value is number =>
  isFiniteNumber(value) && value > 0;

const numberFormatters = new Map<string, Intl.NumberFormat>();

/** Format every user-visible number with Italian decimal and thousands separators. */
export const formatNumber = (
  value: number | null | undefined,
  options: Intl.NumberFormatOptions = {},
): string => {
  const finiteValue = Number.isFinite(value) ? (value as number) : 0;
  const displayValue = Object.is(finiteValue, -0) ? 0 : finiteValue;
  const cacheKey = JSON.stringify(options);
  let formatter = numberFormatters.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.NumberFormat(NUMBER_LOCALE, options);
    numberFormatters.set(cacheKey, formatter);
  }
  return formatter.format(displayValue);
};

/** Format a user-visible decimal with a fixed precision. */
export const formatDecimal = (value: number | null | undefined, decimals = 2): string =>
  formatNumber(value, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

export const calcProductSalePrice = (cost: number, molPercentage: number): number => {
  // Guard against ≥100% MOL (would produce ≤0 or negative denominator)
  if (molPercentage >= 100) return cost;
  return cost / (1 - molPercentage / 100);
};

/** Derive MOL as a percentage of revenue from a unit cost and a unit sale price. */
export const calcProductMolPercentage = (cost: number, salePrice: number): number | null => {
  if (!Number.isFinite(cost) || !Number.isFinite(salePrice) || cost < 0 || salePrice < 0) {
    return null;
  }
  if (salePrice === 0) return cost === 0 ? 0 : null;

  const mol = roundCurrency(((salePrice - cost) / salePrice) * 100);
  return Math.min(MAX_MOL_PERCENTAGE, Math.max(MIN_MOL_PERCENTAGE, mol));
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
  // Canonical whole months retained for API/data compatibility.
  durationMonths?: number;
  // Pricing uses the numeric duration value rendered in this unit.
  durationUnit?: DurationUnit;
  /** Version 1 preserves totals saved before unit labels stopped converting prices. */
  pricingSemanticsVersion?: PricingSemanticsVersion;
}

export const getEffectiveCost = (item: PricingItem): number => {
  if (item.supplierQuoteItemId) return Number(item.supplierQuoteUnitPrice ?? 0);
  return Number(item.productCost ?? 0);
};

// Quantity units are labels and never reprice a line. Product and supplier-sourced costs therefore
// keep the exact numeric value entered or copied, regardless of whether the line uses hours, days,
// or units.
export const getEffectiveUnitCost = (item: PricingItem): number => {
  const cost = getEffectiveCost(item);
  return !item.supplierQuoteItemId &&
    item.unitType === 'days' &&
    item.pricingSemanticsVersion === LEGACY_PRICING_SEMANTICS_VERSION
    ? cost * 8
    : cost;
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

// Economic multiplier represented by the value shown in the selected duration unit. Storage stays
// in canonical whole months for API/data compatibility, but a stored 12 months labelled as one
// year multiplies by 1, while 12 months labelled as months multiplies by 12.
export const getEffectiveDurationMultiplier = (item: PricingItem): number => {
  const durationUnit = normalizeDurationUnit(item.durationUnit);
  if (durationUnit === 'na') return 1;
  const storedMonths = Number(item.durationMonths);
  if (!Number.isFinite(storedMonths) || storedMonths <= 0) return 1;
  if (item.pricingSemanticsVersion === LEGACY_PRICING_SEMANTICS_VERSION) return storedMonths;
  return durationUnit === 'years' ? storedMonths / MONTHS_PER_YEAR : storedMonths;
};

// Supplier documents persist the gross/list unit price plus an inclusive 0-100 line discount.
// Round the derived unit cost before quantity and duration multiply it, matching the persisted
// supplier-quote pricing invariant and preventing downstream orders/invoices from drifting by
// fractional cents.
export const getDiscountedUnitPrice = (unitPrice?: number, discount?: number): number => {
  const percentage = Number(discount) || 0;
  return roundCurrency((Number(unitPrice) || 0) * (1 - percentage / 100));
};

export const getDiscountedLineTotal = (item: PricingItem): number =>
  (Number(item.quantity) || 0) *
  getDiscountedUnitPrice(item.unitPrice, item.discount) *
  getEffectiveDurationMultiplier(item);

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

// Unlike getDurationDisplayValue, this helper preserves an unfilled duration so editable fields
// can show their text placeholder. Pricing keeps the neutral ×1 multiplier for blank values.
export const getDurationInputValue = (item: PricingItem): number | undefined => {
  if (item.durationMonths === undefined || item.durationMonths === null) return undefined;
  const months = Number(item.durationMonths);
  if (!Number.isFinite(months) || months <= 0) return undefined;
  return normalizeDurationUnit(item.durationUnit) === 'years' ? months / MONTHS_PER_YEAR : months;
};

// Keep blank durations blank and pair them with the canonical default display unit. This avoids
// persisting an empty "years" duration that the backend would normalize to one month (0.08 years).
export const normalizeDurationForSubmit = (
  item: PricingItem,
): { durationMonths: number | undefined; durationUnit: DurationUnit } => {
  const durationUnit = normalizeDurationUnit(item.durationUnit);
  if (durationUnit === 'na') return { durationMonths: undefined, durationUnit };

  const durationMonths = Number(item.durationMonths);
  if (!Number.isFinite(durationMonths) || durationMonths <= 0) {
    return { durationMonths: undefined, durationUnit: 'months' };
  }

  return { durationMonths, durationUnit };
};

// Parse a duration-input string (expressed in `unit`) into canonical whole months ≥ 1 (issue
// #757). Empty/invalid input falls back to one of the chosen unit (1 month / 1 year). Shared by
// the quote/offer/order/invoice line-item rows so the parse-and-clamp rule lives in one place.
// Parses with parseFloat (not parseInt): in 'years' a non-multiple of 12 months renders as a
// fractional year (e.g. 18 months → 1.5), and that decimal must survive editing — `durationValueToMonths`
// then folds it back to canonical whole months (1.5 × 12 = 18), so the value round-trips.
export const parseDurationValueToMonths = (value: string, unit: DurationUnit): number => {
  const parsed = Number.parseFloat(normalizeLocalizedNumber(value));
  if (value === '' || Number.isNaN(parsed)) return durationValueToMonths(1, unit);
  return durationValueToMonths(Math.max(1, parsed), unit);
};

export interface ItemPricingContext {
  baseCost: number;
  unitCost: number;
  molPercentage: number;
  quantity: number;
  /** Canonical stored months retained for API/data compatibility. */
  durationMonths: number;
  /** Numeric duration value shown to the user and applied to pricing. */
  durationMultiplier: number;
  lineCost: number;
  discountPercentage: number;
  revenueMultiplier: number;
  grossRevenue: number;
  lineDiscount: number;
  netRevenue: number;
  lineMargin: number;
}

export const getItemPricingContext = (item: PricingItem): ItemPricingContext => {
  const baseCost = getEffectiveCost(item);
  const unitCost = getEffectiveUnitCost(item);
  const molPercentage = getEffectiveMol(item);
  const quantity = Number(item.quantity || 0);
  const durationMonths = getEffectiveDurationMonths(item);
  const durationMultiplier = getEffectiveDurationMultiplier(item);
  const lineCost = unitCost * quantity * durationMultiplier;
  const discountPercentage = Math.min(100, Math.max(0, Number(item.discount || 0)));
  const revenueMultiplier = quantity * durationMultiplier * (1 - discountPercentage / 100);
  const grossRevenue = Number(item.unitPrice || 0) * quantity * durationMultiplier;
  const lineDiscount = (grossRevenue * discountPercentage) / 100;
  const netRevenue = grossRevenue - lineDiscount;
  const lineMargin = netRevenue - lineCost;
  return {
    baseCost,
    unitCost,
    molPercentage,
    quantity,
    durationMonths,
    durationMultiplier,
    lineCost,
    discountPercentage,
    revenueMultiplier,
    grossRevenue,
    lineDiscount,
    netRevenue,
    lineMargin,
  };
};

export interface PricingTotals {
  grossSubtotal: number;
  subtotal: number;
  // Discount applied after line discounts. Kept separate because the global-discount
  // percentage column is calculated against the already-discounted line subtotal.
  discountAmount: number;
  // Sum of every line discount plus the global discount.
  totalDiscountAmount: number;
  // Effective aggregate discount as a percentage of the gross subtotal.
  totalDiscountPercentage: number;
  total: number;
  totalCost: number;
  margin: number;
  marginPercentage: number;
}

export const EMPTY_PRICING_TOTALS: Readonly<PricingTotals> = {
  grossSubtotal: 0,
  subtotal: 0,
  discountAmount: 0,
  totalDiscountAmount: 0,
  totalDiscountPercentage: 0,
  total: 0,
  totalCost: 0,
  margin: 0,
  marginPercentage: 0,
};

export const getDocumentDiscountAmount = (
  subtotal: number,
  discount: number,
  discountType: DiscountType = 'percentage',
): number => {
  const nonNegativeDiscount = Math.max(discount, 0);
  return discountType === 'currency'
    ? Math.min(nonNegativeDiscount, subtotal)
    : subtotal * (Math.min(nonNegativeDiscount, 100) / 100);
};

export const calculatePricingTotals = (
  items: PricingItem[],
  globalDiscount: number,
  discountType: DiscountType = 'percentage',
): PricingTotals => {
  let grossSubtotal = 0;
  let subtotal = 0;
  let totalCost = 0;

  items.forEach((item) => {
    const line = getItemPricingContext(item);
    grossSubtotal += line.grossRevenue;
    subtotal += line.netRevenue;
    totalCost += line.lineCost;
  });

  const discountAmount = getDocumentDiscountAmount(subtotal, globalDiscount, discountType);
  const total = subtotal - discountAmount;
  const margin = total - totalCost;
  const marginPercentage = total > 0 ? (margin / total) * 100 : 0;
  const totalDiscountPercentage =
    grossSubtotal > 0 ? ((grossSubtotal - total) / grossSubtotal) * 100 : 0;
  const roundedGrossSubtotal = roundCurrency(grossSubtotal);
  const roundedTotal = roundCurrency(total);

  // Round at the same precision the backend uses so the rendered totals match what gets
  // persisted (NUMERIC(_, 2)). Without this, accumulating floats like 0.1 + 0.2 leak the
  // 0.30000000000000004 representation into the UI while the backend stores 0.30.
  return {
    grossSubtotal: roundedGrossSubtotal,
    subtotal: roundCurrency(subtotal),
    discountAmount: roundCurrency(discountAmount),
    totalDiscountAmount: roundCurrency(grossSubtotal - total),
    totalDiscountPercentage: roundCurrency(totalDiscountPercentage),
    total: roundedTotal,
    totalCost: roundCurrency(totalCost),
    margin: roundCurrency(margin),
    marginPercentage: roundCurrency(marginPercentage),
  };
};

export const formatDiscountValue = (
  discount: number,
  discountType: DiscountType,
  currency: string,
): string =>
  discountType === 'currency'
    ? `${formatNumber(discount, { maximumFractionDigits: 20 })} ${currency}`
    : `${formatNumber(discount, { maximumFractionDigits: 20 })}%`;

/**
 * Render a margin/MOL percentage for display with a fixed two decimals (e.g. "33,33%").
 * Centralizes the precision so the quote, offer and order views stay consistent; the value
 * is already rounded to two decimals upstream by `calculatePricingTotals`.
 */
export const formatMolPercentage = (value: number): string =>
  `${formatDecimal(value || 0, MOL_PERCENTAGE_DECIMALS)}%`;
