import { roundCurrency } from './invoice-math.ts';

// Largest amount that fits the NUMERIC(15,2) currency columns (list_price, unit_price): 13 integer
// digits plus 2 decimals. A bigger value overflows on INSERT and surfaces as a 500-level database
// error, so callers must be rejected with a clean 400 before persisting.
export const MAX_LINE_AMOUNT = 9_999_999_999_999.99;

export type SupplierLinePricing = {
  listPrice: number;
  discountPercent: number;
  unitPrice: number;
};

// Derive a supplier-quote line's persisted-scale pricing. The list price and the "Sconto a noi"
// discount are first rounded to the DB scale (list_price NUMERIC(15,2), discount_percent
// NUMERIC(5,2)); the net unit cost (Costo unitario) is then derived from those ROUNDED values.
//
// Rounding the inputs before deriving the cost is essential: a caller may submit more than two
// decimals (e.g. listPrice 10.005), which PostgreSQL would round on insert. Deriving unitPrice from
// the raw value would leave the persisted row violating unitPrice = listPrice × (1 − discount/100)
// — a later save could then silently shift totals. Centralising the formula here keeps every write
// path (create, update, snapshot restore) enforcing the same invariant.
export const deriveSupplierLinePricing = (
  listPrice: number,
  discountPercent: number,
): SupplierLinePricing => {
  const roundedListPrice = roundCurrency(listPrice);
  const roundedDiscountPercent = roundCurrency(discountPercent);
  const unitPrice = roundCurrency(roundedListPrice * (1 - roundedDiscountPercent / 100));
  return {
    listPrice: roundedListPrice,
    discountPercent: roundedDiscountPercent,
    unitPrice,
  };
};
