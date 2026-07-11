import type { SupplierQuote, SupplierUnitType } from '../types';
import {
  calcProductSalePrice,
  convertUnitPrice,
  getEffectiveDurationMonths,
  normalizeDurationUnit,
} from './numbers';
import { isFrozenEffectiveStatus } from './quoteStatus';

// Shared #779 bidirectional-sync helpers for the client-quote and client-offer line editors.
// The lock and staleness predicates MUST stay aligned with the server-side rules in
// server/utils/supplier-item-sync.ts (which 409s frozen/order-locked supplier quotes and pushes
// only genuine edits): a predicate drifting in one view would either hide the refresh affordance
// or enable an edit the save then rejects.

export type SupplierQuoteItemRef = {
  quote: SupplierQuote;
  item: SupplierQuote['items'][number];
};

// Whether a quote/offer's product LINES source any supplier quote — the relationship that drives a
// supplier quote's derived status and its forward sync (issue #779 follow-up: the 1:1 header link
// was removed, so line sourcing is the only linkage). Any mutation of such a document can stale the
// separately-cached supplier-quotes table, so the cache handlers gate their refresh on it.
export const sourcesSupplierQuote = (
  doc?: { items?: Array<{ supplierQuoteItemId?: string | null }> } | null,
): boolean => doc?.items?.some((item) => item.supplierQuoteItemId != null) ?? false;

// item id → its CURRENT supplier quote + item, across ALL supplier quotes (not just the
// sourceable ones), so order-lock and staleness resolve even for a line whose quote has since
// left the pickable set.
export const buildSupplierQuoteItemIndex = (
  supplierQuotes: SupplierQuote[],
): Map<string, SupplierQuoteItemRef> => {
  const map = new Map<string, SupplierQuoteItemRef>();
  for (const quote of supplierQuotes) {
    for (const item of quote.items) map.set(item.id, { quote, item });
  }
  return map;
};

// Whether a sourced line's quantity/cost inputs must be disabled. Locks when:
//  - the referenced supplier quote can't be resolved (no supplier-quotes list permission, list
//    still loading, or a legacy dangle): editing blind would only earn a server rejection or a
//    silent divergence — fail safe;
//  - the supplier quote is order-locked: final procurement;
//  - its derived status is frozen (accepted/denied/expired): the server sync 409s the write.
export const isSupplierLineLocked = (
  item: { supplierQuoteItemId?: string | null },
  ref: SupplierQuoteItemRef | undefined,
): boolean => {
  if (!item.supplierQuoteItemId) return false;
  if (!ref) return true;
  return Boolean(ref.quote.linkedOrderId) || isFrozenEffectiveStatus(ref.quote.status);
};

// Whether the line's quantity/cost lag the live supplier item — drives the per-line
// "Data drifted — sync?" refresh chip.
export const isSupplierLineStale = (
  line: {
    quantity: number;
    supplierQuoteUnitPrice?: number | null;
    supplierQuoteBaseQuantity?: number | null;
    supplierQuoteBaseUnitPrice?: number | null;
  },
  source: SupplierQuote['items'][number] | undefined,
): boolean => {
  if (!source) return false;
  // A line picked/refreshed in THIS editing session carries the pick-time baseline: drift means
  // the SUPPLIER moved away from what the user was shown — not that the user deliberately edited
  // the line's quantity/cost (that edit is pushed onto the supplier item on save; flagging it
  // would invite a chip click that reverts it). Lines loaded from a saved document have no
  // baseline and keep the stored-vs-live comparison.
  if (line.supplierQuoteBaseQuantity != null && line.supplierQuoteBaseUnitPrice != null) {
    return (
      Number(line.supplierQuoteBaseUnitPrice) !== source.unitPrice ||
      Number(line.supplierQuoteBaseQuantity) !== source.quantity
    );
  }
  return (
    Number(line.supplierQuoteUnitPrice ?? 0) !== source.unitPrice ||
    Number(line.quantity) !== source.quantity
  );
};

// The fields the pick path and the refresh chip graft onto a line when pulling the supplier
// item's current data, mirroring the linking math: the sale price is recomputed from the
// refreshed cost and the line's own MOL, converted into the line's unit. The supplierQuoteBase*
// pair records WHAT the user was shown at pick/refresh time — the server diffs the saved
// quantity/cost against it to recognize a deliberate pre-save edit on a fresh link (pushed onto
// the supplier item) versus an untouched stale snapshot (server values win).
export const refreshedSupplierLineFields = (
  line: { productMolPercentage?: number | string | null; unitType?: SupplierUnitType },
  source: SupplierQuote['items'][number],
): {
  quantity: number;
  supplierQuoteUnitPrice: number;
  supplierQuoteBaseQuantity: number;
  supplierQuoteBaseUnitPrice: number;
  unitPrice: number;
} => {
  const mol = line.productMolPercentage ? Number(line.productMolPercentage) : 0;
  return {
    quantity: source.quantity,
    supplierQuoteUnitPrice: source.unitPrice,
    supplierQuoteBaseQuantity: source.quantity,
    supplierQuoteBaseUnitPrice: source.unitPrice,
    // Convert FROM the supplier item's own unit, not a hardcoded 'hours': source.unitPrice is
    // priced in source.unitType. Assuming hours would multiply a days-priced item by 8 when the
    // line is also in days (units match → no conversion), inflating the stored sale price.
    unitPrice: convertUnitPrice(
      calcProductSalePrice(source.unitPrice, mol),
      source.unitType || 'hours',
      line.unitType || 'hours',
    ),
  };
};

// A freshly picked supplier item also initializes the client line's duration. Keep this separate
// from the refresh helper above: quantity/cost are bidirectionally synchronized after linking,
// while duration is only inherited when the supplier item is selected and can then be customized
// independently on the client document.
export const pickedSupplierLineFields = (
  line: { productMolPercentage?: number | string | null; unitType?: SupplierUnitType },
  source: SupplierQuote['items'][number],
) => ({
  ...refreshedSupplierLineFields(line, source),
  durationMonths: getEffectiveDurationMonths(source),
  durationUnit: normalizeDurationUnit(source.durationUnit),
});
