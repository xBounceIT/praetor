import { describe, expect, test } from 'bun:test';
import type { SupplierQuote } from '../../types';
import {
  buildSupplierQuoteItemIndex,
  isSupplierLineLocked,
  isSupplierLineStale,
  pickedSupplierLineFields,
  refreshedSupplierLineFields,
} from '../../utils/supplierLineSync';

const supplierItem = (over: Record<string, unknown> = {}) => ({
  id: 'sqi-1',
  quoteId: 'SQ-1',
  productId: 'p-1',
  productName: 'Widget',
  quantity: 4,
  listPrice: 100,
  discountPercent: 20,
  unitPrice: 80,
  unitType: 'hours' as const,
  ...over,
});

const supplierQuote = (over: Record<string, unknown> = {}): SupplierQuote =>
  ({
    id: 'SQ-1',
    supplierId: 'sup-1',
    supplierName: 'Acme',
    paymentTerms: 'immediate',
    status: 'draft',
    expirationDate: '2999-12-31',
    items: [supplierItem()],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over,
  }) as SupplierQuote;

describe('buildSupplierQuoteItemIndex', () => {
  test('maps every item id to its quote+item pair', () => {
    const quote = supplierQuote();
    const index = buildSupplierQuoteItemIndex([quote]);
    expect(index.get('sqi-1')?.quote.id).toBe('SQ-1');
    expect(index.get('sqi-1')?.item.unitPrice).toBe(80);
    expect(index.get('missing')).toBeUndefined();
  });
});

describe('isSupplierLineLocked', () => {
  const ref = (over: Record<string, unknown> = {}) => ({
    quote: supplierQuote(over),
    item: supplierItem(),
  });

  test('unlinked lines are never locked', () => {
    expect(isSupplierLineLocked({ supplierQuoteItemId: null }, undefined)).toBe(false);
  });

  test('FAIL-SAFE: a linked line whose reference cannot be resolved locks', () => {
    // No supplier-quotes list permission, list still loading, or a legacy dangle: editing blind
    // would only earn a server rejection or a silent divergence (#779 review pass 4).
    expect(isSupplierLineLocked({ supplierQuoteItemId: 'sqi-1' }, undefined)).toBe(true);
  });

  test('order-locked supplier quotes lock the line', () => {
    expect(
      isSupplierLineLocked({ supplierQuoteItemId: 'sqi-1' }, ref({ linkedOrderId: 'sso-1' })),
    ).toBe(true);
  });

  test.each(['accepted', 'denied', 'expired'])('frozen derived status %s locks the line', (s) => {
    expect(isSupplierLineLocked({ supplierQuoteItemId: 'sqi-1' }, ref({ status: s }))).toBe(true);
  });

  test.each(['draft', 'sent', 'offer'])('live derived status %s stays editable', (s) => {
    expect(isSupplierLineLocked({ supplierQuoteItemId: 'sqi-1' }, ref({ status: s }))).toBe(false);
  });
});

describe('isSupplierLineStale', () => {
  const source = supplierItem();

  test('false when quantity and cost match the live item', () => {
    expect(isSupplierLineStale({ quantity: 4, supplierQuoteUnitPrice: 80 }, source)).toBe(false);
  });

  test('true on a cost drift', () => {
    expect(isSupplierLineStale({ quantity: 4, supplierQuoteUnitPrice: 60 }, source)).toBe(true);
  });

  test('true on a quantity drift', () => {
    expect(isSupplierLineStale({ quantity: 2, supplierQuoteUnitPrice: 80 }, source)).toBe(true);
  });

  test('false when the source item cannot be resolved', () => {
    expect(isSupplierLineStale({ quantity: 2, supplierQuoteUnitPrice: 60 }, undefined)).toBe(false);
  });

  test('a deliberate in-session edit is NOT drift when the baseline matches the live item', () => {
    // The line was picked at the current supplier values (baseline 4/80) and the user then edited
    // the cost to 95: that edit is pushed on save — the chip must not invite a click that would
    // revert it.
    expect(
      isSupplierLineStale(
        {
          quantity: 4,
          supplierQuoteUnitPrice: 95,
          supplierQuoteBaseQuantity: 4,
          supplierQuoteBaseUnitPrice: 80,
        },
        source,
      ),
    ).toBe(false);
  });

  test('true when the supplier moved away from the pick-time baseline', () => {
    // Picked when the item cost 60; the supplier item now reads 80 → genuine upstream drift,
    // regardless of what the user typed into the line afterwards.
    expect(
      isSupplierLineStale(
        {
          quantity: 4,
          supplierQuoteUnitPrice: 60,
          supplierQuoteBaseQuantity: 4,
          supplierQuoteBaseUnitPrice: 60,
        },
        source,
      ),
    ).toBe(true);
  });
});

describe('refreshedSupplierLineFields', () => {
  test('pulls quantity + cost and recomputes the sale price from the line MOL', () => {
    const fields = refreshedSupplierLineFields(
      { productMolPercentage: 20, unitType: 'hours' },
      supplierItem(),
    );
    expect(fields.quantity).toBe(4);
    expect(fields.supplierQuoteUnitPrice).toBe(80);
    // calcProductSalePrice(80, 20) = 80 / 0.8 = 100, hours→hours = identity.
    expect(fields.unitPrice).toBe(100);
  });

  test('stamps the pick-time baseline alongside the live values (genuine-edit anchor)', () => {
    // The supplierQuoteBase* pair records what the user was shown at pick/refresh time; the
    // server diffs the saved quantity/cost against it to recognize a deliberate pre-save edit on
    // a fresh link (pushed onto the supplier item) versus an untouched stale snapshot.
    const fields = refreshedSupplierLineFields(
      { productMolPercentage: 20, unitType: 'hours' },
      supplierItem(),
    );
    expect(fields.supplierQuoteBaseQuantity).toBe(4);
    expect(fields.supplierQuoteBaseUnitPrice).toBe(80);
    expect(fields.supplierQuoteBaseQuantity).toBe(fields.quantity);
    expect(fields.supplierQuoteBaseUnitPrice).toBe(fields.supplierQuoteUnitPrice);
  });

  test("converts the sale price into the line's unit (hours→days = ×8)", () => {
    const fields = refreshedSupplierLineFields(
      { productMolPercentage: null, unitType: 'days' },
      supplierItem(),
    );
    expect(fields.unitPrice).toBe(80 * 8);
  });

  test('a days-priced source refreshed into a days line is NOT re-multiplied (#812)', () => {
    // The supplier item is already priced per day; treating it as hourly would ×8 it even though
    // the line is also in days. Units match → no conversion.
    const fields = refreshedSupplierLineFields(
      { productMolPercentage: null, unitType: 'days' },
      supplierItem({ unitType: 'days', unitPrice: 80 }),
    );
    expect(fields.unitPrice).toBe(80);
  });

  test('converts FROM the source unit when units differ (days source → hours line = ÷8)', () => {
    const fields = refreshedSupplierLineFields(
      { productMolPercentage: null, unitType: 'hours' },
      supplierItem({ unitType: 'days', unitPrice: 80 }),
    );
    expect(fields.unitPrice).toBe(10);
  });
});

describe('pickedSupplierLineFields', () => {
  test('inherits the supplier duration value and display unit on initial selection', () => {
    const fields = pickedSupplierLineFields(
      { productMolPercentage: 20, unitType: 'hours' },
      supplierItem({ durationMonths: 24, durationUnit: 'years' }),
    );

    expect(fields.durationMonths).toBe(24);
    expect(fields.durationUnit).toBe('years');
  });
});
