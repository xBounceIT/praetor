import { roundCurrency, roundToDecimalPlaces } from './invoice-math.ts';

// Largest amount accepted by the NUMERIC(15,2) list-price column: 13 integer digits plus 2
// decimals. The derived NUMERIC(19,6) unit cost keeps the same integer capacity, so this boundary
// protects both columns and lets callers receive a clean 400 before persistence.
export const MAX_LINE_AMOUNT = 9_999_999_999_999.99;

export type SupplierLinePricing = {
  listPrice: number;
  discountPercent: number;
  unitPrice: number;
};

const UNIT_PRICE_DECIMAL_PLACES = 6;

export const normalizeSupplierUnitPrice = (unitPrice: number): number =>
  roundToDecimalPlaces(unitPrice, UNIT_PRICE_DECIMAL_PLACES);

// Derive a supplier-quote line's persisted-scale pricing. The list price and the "Sconto a noi"
// discount are first rounded to the DB scale (list_price NUMERIC(15,2), discount_percent
// NUMERIC(5,2)); the net unit cost (Costo unitario) is then derived from those rounded values and
// retained at NUMERIC(19,6) precision so line multipliers do not compound display rounding.
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
  const unitPrice = normalizeSupplierUnitPrice(
    roundedListPrice * (1 - roundedDiscountPercent / 100),
  );
  return {
    listPrice: roundedListPrice,
    discountPercent: roundedDiscountPercent,
    unitPrice,
  };
};
