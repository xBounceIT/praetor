import { effectiveDurationMonths } from './duration-unit.ts';

type ItemMath = {
  quantity?: number;
  unitPrice?: number;
  discount?: number;
  legacyDiscountRounding?: boolean;
  // Per-item Italian VAT (IVA) rate in percent. Optional so pre-tax-feature data still computes.
  taxRate?: number;
  // Months the line's service runs (issue #757). Multiplies the taxable amount alongside
  // quantity. Absent/invalid → 1, so pre-duration rows keep their totals.
  durationMonths?: number;
  // Display unit for the duration; 'na' (N/A) marks a line where duration does not apply and
  // never multiplies, regardless of `durationMonths` (issue #775).
  durationUnit?: string;
};

const CURRENCY_DECIMAL_PLACES = 2;

const shiftDecimal = (value: number, decimalPlaces: number): number => {
  const [coefficient, exponent = '0'] = value.toString().split('e');
  return Number(`${coefficient}e${Number(exponent) + decimalPlaces}`);
};

// Round a finite value to an explicit decimal scale. The frontend mirrors this helper in
// `utils/numbers.ts` so both layers agree on persisted prices and rendered totals.
export const roundToDecimalPlaces = (value: number, decimalPlaces: number): number => {
  if (!Number.isFinite(value)) return value;

  const sign = Math.sign(value);
  if (sign === 0) return 0;

  const scaled = Math.round(shiftDecimal(Math.abs(value), decimalPlaces));
  if (scaled === 0) return 0;

  return sign * shiftDecimal(scaled, -decimalPlaces);
};

// Match the NUMERIC(_, 2) precision used by currency-total columns in PostgreSQL.
export const roundCurrency = (value: number): number =>
  roundToDecimalPlaces(value, CURRENCY_DECIMAL_PLACES);

// Preserve fractional cents until every line multiplier has been applied. Currency rounding is a
// document-boundary operation; doing it at unit level compounds the error for large quantities.
export const getDiscountedLineTotal = (item: ItemMath): number => {
  const quantity = item.quantity ?? 0;
  const unitPrice = item.unitPrice ?? 0;
  const discount = Math.min(100, Math.max(0, item.discount ?? 0));
  const duration = effectiveDurationMonths(item.durationUnit, item.durationMonths);
  const discountedUnitPrice = unitPrice * (1 - discount / 100);
  const calculationUnitPrice = item.legacyDiscountRounding
    ? roundCurrency(discountedUnitPrice)
    : discountedUnitPrice;
  return quantity * calculationUnitPrice * duration;
};

export const getDocumentDiscountAmount = (
  subtotal: number,
  discount: number,
  discountType: 'percentage' | 'currency' = 'percentage',
): number => {
  const nonNegativeDiscount = Math.max(discount, 0);
  return discountType === 'currency'
    ? Math.min(nonNegativeDiscount, subtotal)
    : subtotal * (Math.min(nonNegativeDiscount, 100) / 100);
};

export const computeInvoiceTotals = (
  items: ItemMath[],
): { subtotal: number; taxTotal: number; total: number } => {
  let subtotalRaw = 0;
  let taxTotalRaw = 0;
  for (const item of items) {
    const taxableAmount = getDiscountedLineTotal(item);
    const taxRate = item.taxRate ?? 0;
    subtotalRaw += taxableAmount;
    taxTotalRaw += (taxableAmount * taxRate) / 100;
  }
  const subtotal = roundCurrency(subtotalRaw);
  const taxTotal = roundCurrency(taxTotalRaw);
  // Compute total from the rounded components so the displayed parts always sum to the total.
  const total = roundCurrency(subtotal + taxTotal);
  return { subtotal, taxTotal, total };
};
