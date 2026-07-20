import { describe, expect, test } from 'bun:test';
import type { OfferVersionSnapshot } from '../../db/schema/offerVersions.ts';
import { nextRevisionNumber, offerRevisionContentEqual } from '../../services/documentRevisions.ts';

const snapshot = (): OfferVersionSnapshot => ({
  schemaVersion: 1,
  offer: {
    id: 'OFF_26_001',
    linkedQuoteId: 'PREV_26_001',
    linkedQuoteCandidateId: 'candidate-a',
    clientId: 'client-1',
    clientName: 'Client One',
    paymentTerms: '30gg',
    discount: 0,
    discountType: 'percentage',
    status: 'sent',
    deliveryDate: '2026-07-20',
    expirationDate: '2026-08-20',
    notes: 'Commercial notes',
    createdAt: 100,
    updatedAt: 200,
  },
  items: [
    {
      id: 'item-1',
      offerId: 'OFF_26_001',
      productId: 'product-1',
      productName: 'Service',
      quantity: 2,
      unitPrice: 100,
      productCost: 50,
      productMolPercentage: 50,
      supplierQuoteId: 'PF_26_001',
      supplierQuoteItemId: 'supplier-item-1',
      supplierQuoteSupplierName: 'Supplier',
      supplierQuoteUnitPrice: 50,
      unitType: 'unit',
      note: null,
      discount: 0,
      durationMonths: 1,
      durationUnit: 'months',
    },
  ],
});

describe('document revision comparison', () => {
  test('ignores technical IDs, status, and timestamps', () => {
    const left = snapshot();
    const right = snapshot();
    right.offer.id = 'renamed-id';
    right.offer.status = 'draft';
    right.offer.createdAt = 999;
    right.offer.updatedAt = 1000;
    right.items[0].id = 'replacement-item-id';
    right.items[0].offerId = 'renamed-id';
    expect(offerRevisionContentEqual(left, right)).toBe(true);
  });

  test('detects business-field changes and line order changes', () => {
    const left = snapshot();
    const changed = snapshot();
    changed.items[0].quantity = 3;
    expect(offerRevisionContentEqual(left, changed)).toBe(false);

    const reordered = snapshot();
    reordered.items.push({ ...reordered.items[0], id: 'item-2', productName: 'Second' });
    const reverse = structuredClone(reordered);
    reverse.items.reverse();
    expect(offerRevisionContentEqual(reordered, reverse)).toBe(false);
  });

  test('allocates after the reserved high-water mark', () => {
    expect(nextRevisionNumber(0)).toBe(1);
    expect(nextRevisionNumber(4)).toBe(5);
  });
});
