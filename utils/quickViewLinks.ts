import type { SupplierQuote } from '../types';
import { buildViewDeepLink } from './hashCanonicalization';

// Shared helpers behind the per-line quick-view shortcut (open a referenced
// supplier quote / product on its own pre-filtered page in a new tab). The four
// document editors — client quotes, offers, orders, invoices — all resolve the
// same hrefs, so the logic lives here once instead of being copy-pasted per view.

// item id → parent supplier-quote id, across ALL supplier quotes (not only the
// currently-selectable accepted/non-expired ones). A line that references a
// supplier quote which has since left "accepted" or expired still resolves its
// parent here, so the quick-view shortcut keeps working for it.
export const buildQuoteIdBySupplierQuoteItemId = (
  supplierQuotes: SupplierQuote[],
): Map<string, string> => {
  const map = new Map<string, string>();
  for (const quote of supplierQuotes) {
    for (const item of quote.items) map.set(item.id, quote.id);
  }
  return map;
};

// Parent supplier-quote id for a document line. Prefers the snapshot stored on
// the item, falling back to the linked supplier-quote item's parent quote.
export const resolveLinkedSupplierQuoteId = (
  item: { supplierQuoteId?: string | null; supplierQuoteItemId?: string | null },
  quoteIdBySupplierQuoteItemId: ReadonlyMap<string, string>,
): string | null => {
  if (item.supplierQuoteId) return item.supplierQuoteId;
  if (item.supplierQuoteItemId) {
    return quoteIdBySupplierQuoteItemId.get(item.supplierQuoteItemId) ?? null;
  }
  return null;
};

// Deep-link href to a supplier quote's pre-filtered page, or null when the
// shortcut must not render: the user lacks access, the line references nothing,
// or the referenced quote is no longer loaded (so the link would dead-end on the
// full listing instead of the record).
export const buildSupplierQuoteQuickViewHref = (
  linkedSupplierQuoteId: string | null,
  supplierQuoteIds: ReadonlySet<string>,
  canView: boolean,
): string | null =>
  canView && linkedSupplierQuoteId && supplierQuoteIds.has(linkedSupplierQuoteId)
    ? buildViewDeepLink('sales/supplier-quotes', linkedSupplierQuoteId)
    : null;

// Deep-link href to a product's pre-filtered page, gated/guarded like
// buildSupplierQuoteQuickViewHref above.
export const buildProductQuickViewHref = (
  productId: string | null | undefined,
  productIds: ReadonlySet<string>,
  canView: boolean,
): string | null =>
  canView && productId && productIds.has(productId)
    ? buildViewDeepLink('catalog/internal-listing', productId)
    : null;
