import { describe, expect, test } from 'bun:test';
import type { SupplierQuote } from '../../types';
import {
  buildProductQuickViewHref,
  buildQuoteIdBySupplierQuoteItemId,
  buildSupplierOrderQuickViewHref,
  buildSupplierQuoteQuickViewHref,
  resolveLinkedSupplierQuoteId,
} from '../../utils/quickViewLinks';

// The builder only reads quote.id and quote.items[].id, so the fixtures stay minimal.
const supplierQuotes = [
  { id: 'SQ-ACCEPTED', items: [{ id: 'sqi-a1' }, { id: 'sqi-a2' }] },
  { id: 'SQ-EXPIRED', items: [{ id: 'sqi-e1' }] },
] as unknown as SupplierQuote[];

describe('buildQuoteIdBySupplierQuoteItemId', () => {
  test('maps every item id to its parent quote id across all quotes (accepted or not)', () => {
    const map = buildQuoteIdBySupplierQuoteItemId(supplierQuotes);
    expect(map.get('sqi-a1')).toBe('SQ-ACCEPTED');
    expect(map.get('sqi-a2')).toBe('SQ-ACCEPTED');
    // Crucially, an item from a non-accepted/expired quote still resolves — this is
    // the behavior that previously differed between the quote and offer editors.
    expect(map.get('sqi-e1')).toBe('SQ-EXPIRED');
    expect(map.get('missing')).toBeUndefined();
  });
});

describe('resolveLinkedSupplierQuoteId', () => {
  const map = buildQuoteIdBySupplierQuoteItemId(supplierQuotes);

  test('prefers the snapshot id stored on the item', () => {
    expect(
      resolveLinkedSupplierQuoteId({ supplierQuoteId: 'SNAP', supplierQuoteItemId: 'sqi-a1' }, map),
    ).toBe('SNAP');
  });

  test('falls back to the linked item id → parent quote map when no snapshot', () => {
    expect(
      resolveLinkedSupplierQuoteId({ supplierQuoteId: null, supplierQuoteItemId: 'sqi-e1' }, map),
    ).toBe('SQ-EXPIRED');
  });

  test('returns null when nothing references a quote', () => {
    expect(resolveLinkedSupplierQuoteId({}, map)).toBeNull();
    expect(resolveLinkedSupplierQuoteId({ supplierQuoteItemId: 'unknown-item' }, map)).toBeNull();
  });
});

describe('buildSupplierQuoteQuickViewHref', () => {
  const ids = new Set(['SQ-1']);

  test('builds a pre-filtered deep link when the quote is loaded', () => {
    expect(buildSupplierQuoteQuickViewHref('SQ-1', ids)).toBe(
      '#/sales/supplier-quotes?filterId=SQ-1',
    );
  });

  // Permission is the caller's concern (it hides the whole shortcut), so the
  // builder only guards reference existence — a missing/unloaded quote yields null
  // and the shortcut renders disabled instead of dead-ending.
  test('returns null for a missing id or a quote no longer loaded', () => {
    expect(buildSupplierQuoteQuickViewHref(null, ids)).toBeNull();
    expect(buildSupplierQuoteQuickViewHref('SQ-GONE', ids)).toBeNull();
  });
});

describe('buildProductQuickViewHref', () => {
  const ids = new Set(['prod-1']);

  test('builds a pre-filtered deep link when the product is loaded', () => {
    expect(buildProductQuickViewHref('prod-1', ids)).toBe(
      '#/catalog/internal-listing?filterId=prod-1',
    );
  });

  test('returns null for an empty/absent or unloaded product id', () => {
    expect(buildProductQuickViewHref(undefined, ids)).toBeNull();
    expect(buildProductQuickViewHref('', ids)).toBeNull();
    expect(buildProductQuickViewHref('prod-gone', ids)).toBeNull();
  });
});

describe('buildSupplierOrderQuickViewHref', () => {
  const ids = new Set(['SO-1']);

  test('builds a pre-filtered deep link when the supplier order is loaded', () => {
    expect(buildSupplierOrderQuickViewHref('SO-1', ids)).toBe(
      '#/accounting/supplier-orders?filterId=SO-1',
    );
  });

  // Like the sibling builders: permission gating is the caller's concern, so this
  // only guards reference existence — a missing/unloaded order yields null and the
  // shortcut renders disabled instead of dead-ending on the full listing.
  test('returns null for an empty/absent or unloaded supplier order id', () => {
    expect(buildSupplierOrderQuickViewHref(undefined, ids)).toBeNull();
    expect(buildSupplierOrderQuickViewHref(null, ids)).toBeNull();
    expect(buildSupplierOrderQuickViewHref('', ids)).toBeNull();
    expect(buildSupplierOrderQuickViewHref('SO-GONE', ids)).toBeNull();
  });
});
