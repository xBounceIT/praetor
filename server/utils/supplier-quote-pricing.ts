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

export type SupplierDocumentLinePricing = {
  unitPrice: number;
  discount: number;
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
// — a later save could then silently shift totals. Centralising the formula here keeps new and
// price-edited rows consistent; update and restore may instead retain an explicit authoritative
// cost when the canonical list price and discount have not changed.
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

// Supplier orders and invoices store a gross unit price plus a line discount at currency scale.
// Keep that richer pricing chain when it reproduces the quote's authoritative net cost. A
// client-to-supplier sync can intentionally preserve a scale-2 client cost that differs from the
// quote formula by fractional cents; flatten that exceptional value to net price + zero discount
// so downstream documents round-trip the accepted cost instead of silently re-deriving it.
export const toSupplierDocumentLinePricing = (
  pricing: SupplierLinePricing,
): SupplierDocumentLinePricing => {
  const canonical = deriveSupplierLinePricing(pricing.listPrice, pricing.discountPercent);
  const authoritativeUnitPrice = normalizeSupplierUnitPrice(pricing.unitPrice);
  if (canonical.unitPrice === authoritativeUnitPrice) {
    return { unitPrice: canonical.listPrice, discount: canonical.discountPercent };
  }
  return { unitPrice: roundCurrency(authoritativeUnitPrice), discount: 0 };
};

// Version snapshots created before migration 0116 stored formula-derived unit costs at scale 2.
// Upgrade that recognizable legacy shape during restore, but preserve the same value when a
// client-sync audit proves that the rounded cost was explicit and authoritative.
export const resolveRestoredSupplierUnitPrice = (
  pricing: SupplierLinePricing,
  hasClientSyncMarker: boolean,
): number => {
  const snapshotUnitPrice = normalizeSupplierUnitPrice(pricing.unitPrice);
  const derivedUnitPrice = deriveSupplierLinePricing(
    pricing.listPrice,
    pricing.discountPercent,
  ).unitPrice;
  const isLegacyFormulaCost =
    snapshotUnitPrice === roundCurrency(derivedUnitPrice) && snapshotUnitPrice !== derivedUnitPrice;

  return !hasClientSyncMarker && isLegacyFormulaCost ? derivedUnitPrice : snapshotUnitPrice;
};

type SupplierQuoteSnapshotPricing = {
  listPrice?: number | null;
  discountPercent?: number | null;
  unitPrice?: number | null;
};

// Normalize the persisted-scale pricing shown by a version preview and later written by restore.
// Older snapshots may lack the gross/discount keys; in that case their net unit price remains a
// zero-discount line. Keeping this transformation shared prevents preview and restore totals from
// disagreeing about legacy scale-2 formula costs.
export const normalizeSupplierQuoteSnapshotPricing = <T extends SupplierQuoteSnapshotPricing>(
  item: T,
  hasClientSyncMarker: boolean,
): T & SupplierLinePricing => {
  const snapshotUnitPrice = Number(item.unitPrice ?? 0);
  const pricing = deriveSupplierLinePricing(
    Number(item.listPrice ?? snapshotUnitPrice),
    Number(item.discountPercent ?? 0),
  );
  return {
    ...item,
    ...pricing,
    unitPrice: resolveRestoredSupplierUnitPrice(
      { ...pricing, unitPrice: snapshotUnitPrice },
      hasClientSyncMarker,
    ),
  };
};
