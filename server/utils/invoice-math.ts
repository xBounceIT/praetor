import { effectiveDurationMonths } from './duration-unit.ts';

type ItemMath = {
  quantity?: number;
  unitPrice?: number;
  discount?: number;
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

// Match the NUMERIC(_, 2) precision used for invoice columns so totals computed here
// align with what would be re-derived from the persisted rows. The frontend mirrors this
// helper in `utils/numbers.ts` so both layers agree on rendered values.
export const roundCurrency = (value: number): number => {
  if (!Number.isFinite(value)) return value;

  const sign = Math.sign(value);
  if (sign === 0) return 0;

  const cents = Math.round(shiftDecimal(Math.abs(value), CURRENCY_DECIMAL_PLACES));
  if (cents === 0) return 0;

  return sign * shiftDecimal(cents, -CURRENCY_DECIMAL_PLACES);
};

export const getDiscountedUnitPrice = (unitPrice: number, discount: number): number =>
  roundCurrency(unitPrice * (1 - discount / 100));

export const computeInvoiceTotals = (
  items: ItemMath[],
): { subtotal: number; taxTotal: number; total: number } => {
  let subtotalRaw = 0;
  let taxTotalRaw = 0;
  for (const item of items) {
    const quantity = item.quantity ?? 0;
    const unitPrice = item.unitPrice ?? 0;
    const discount = item.discount ?? 0;
    // 'N/A' lines never multiply by duration (issue #775); absent/non-positive months fall to 1.
    const effectiveDuration = effectiveDurationMonths(item.durationUnit, item.durationMonths);
    const discountFactor = 1 - discount / 100;
    const taxableAmount = quantity * unitPrice * discountFactor * effectiveDuration;
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
