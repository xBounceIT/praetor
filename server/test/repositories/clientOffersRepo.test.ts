import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as clientOffersRepo from '../../repositories/clientOffersRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// Builder paths use rowMode: 'array' — fixture rows are positional in the schema's column
// declaration order.
//
// customerOffers columns (12): [id, linkedQuoteId, clientId, clientName, paymentTerms,
//   discount, discountType, status, expirationDate, notes, createdAt, updatedAt]
//
// customerOfferItems columns (16): [id, offerId, productId, productName, quantity, unitPrice,
//   productCost, productMolPercentage, discount, note, createdAt, unitType, supplierQuoteId,
//   supplierQuoteItemId, supplierQuoteSupplierName, supplierQuoteUnitPrice]
//
// Raw-SQL paths via `executeRows` (`update`, `insertItems`) return objects keyed by the
// SELECT alias (camelCase via `as "fooBar"`), so those fixtures stay as objects.

const offerBuilderRow: unknown[] = [
  'co-1',
  'cq-1',
  'c-1',
  'Acme',
  'net30',
  '5',
  'percentage',
  'draft',
  '2026-06-01',
  null,
  new Date('2026-01-01T00:00:00Z'),
  new Date('2026-01-01T00:01:40Z'),
];

const itemBuilderRow: unknown[] = [
  'coi-1',
  'co-1',
  'p-1',
  'Widget',
  '2',
  '10',
  '5',
  null,
  '0',
  null,
  new Date('2026-01-01T00:00:00Z'),
  'unit',
  null,
  null,
  null,
  null,
];

const offerRawRow = {
  id: 'co-1',
  linkedQuoteId: 'cq-1',
  clientId: 'c-1',
  clientName: 'Acme',
  paymentTerms: 'net30',
  discount: '5',
  discountType: 'percentage',
  status: 'draft',
  expirationDate: new Date('2026-06-01T00:00:00Z'),
  notes: null,
  createdAt: 1735689600000,
  updatedAt: 1735689700000,
};

const itemRawRow = {
  id: 'coi-1',
  offerId: 'co-1',
  productId: 'p-1',
  productName: 'Widget',
  quantity: '2',
  unitPrice: '10',
  productCost: '5',
  productMolPercentage: null,
  supplierQuoteId: null,
  supplierQuoteItemId: null,
  supplierQuoteSupplierName: null,
  supplierQuoteUnitPrice: null,
  unitType: 'unit',
  note: null,
  discount: '0',
};

describe('listAll', () => {
  test('orders by created_at DESC and maps types', async () => {
    exec.enqueue({ rows: [offerBuilderRow] });
    const result = await clientOffersRepo.listAll(testDb);
    expect(exec.calls[0].sql).toContain('from "customer_offers"');
    expect(exec.calls[0].sql).toContain('order by "customer_offers"."created_at" desc');
    expect(result[0].discount).toBe(5);
    expect(result[0].expirationDate).toBe('2026-06-01');
  });
});

describe('listAllItems', () => {
  test('orders items by created_at ASC', async () => {
    exec.enqueue({ rows: [itemBuilderRow] });
    const result = await clientOffersRepo.listAllItems(testDb);
    expect(exec.calls[0].sql).toContain('order by "customer_offer_items"."created_at" asc');
    expect(result[0].quantity).toBe(2);
    expect(result[0].unitPrice).toBe(10);
    expect(result[0].unitType).toBe('unit');
  });
});

describe('existsById / findIdConflict', () => {
  test('existsById returns true on match', async () => {
    exec.enqueue({ rows: [['co-1']] });
    expect(await clientOffersRepo.existsById('co-1', testDb)).toBe(true);
  });

  test('findIdConflict excludes self via != predicate', async () => {
    exec.enqueue({ rows: [] });
    await clientOffersRepo.findIdConflict('new', 'cur', testDb);
    expect(exec.calls[0].sql).toContain('"id" <> $2');
    expect(exec.calls[0].params).toEqual(['new', 'cur']);
  });
});

describe('findForUpdate', () => {
  test('returns existing offer fields needed for permission checks', async () => {
    exec.enqueue({ rows: [['co-1', 'cq-1', 'c-1', 'Acme', 'draft']] });
    const result = await clientOffersRepo.findForUpdate('co-1', testDb);
    expect(result?.linkedQuoteId).toBe('cq-1');
    expect(result?.status).toBe('draft');
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await clientOffersRepo.findForUpdate('co-x', testDb)).toBeNull();
  });
});

describe('findExistingForQuote', () => {
  test('returns offer id when one exists for the quote', async () => {
    exec.enqueue({ rows: [['co-1']] });
    expect(await clientOffersRepo.findExistingForQuote('cq-1', testDb)).toBe('co-1');
  });

  test('returns null when none exists', async () => {
    exec.enqueue({ rows: [] });
    expect(await clientOffersRepo.findExistingForQuote('cq-1', testDb)).toBeNull();
  });
});

describe('findLinkedSaleId', () => {
  test('queries sales.linked_offer_id and returns sale id', async () => {
    exec.enqueue({ rows: [['s-1']] });
    const result = await clientOffersRepo.findLinkedSaleId('co-1', testDb);
    expect(exec.calls[0].sql).toContain('from "sales"');
    expect(exec.calls[0].sql).toContain('"linked_offer_id" = $1');
    expect(result).toBe('s-1');
  });
});

describe('create', () => {
  test('inserts 10 fields and returns mapped offer', async () => {
    exec.enqueue({ rows: [offerBuilderRow] });
    const result = await clientOffersRepo.create(
      {
        id: 'co-1',
        linkedQuoteId: 'cq-1',
        clientId: 'c-1',
        clientName: 'Acme',
        paymentTerms: 'net30',
        discount: 5,
        discountType: 'percentage',
        status: 'draft',
        expirationDate: '2026-06-01',
        notes: null,
      },
      testDb,
    );
    expect(exec.calls[0].sql).toContain('insert into "customer_offers"');
    expect(exec.calls[0].params).toHaveLength(10);
    expect(result.id).toBe('co-1');
  });
});

describe('update', () => {
  test('passes 10 params and uses COALESCE preservation (raw SQL)', async () => {
    exec.enqueue({ rows: [offerRawRow] });
    await clientOffersRepo.update('co-1', { status: 'accepted' }, testDb);
    expect(exec.calls[0].sql).toContain('UPDATE customer_offers');
    expect(exec.calls[0].sql).toContain('updated_at = CURRENT_TIMESTAMP');
    expect(exec.calls[0].sql).toContain('COALESCE');
    expect(exec.calls[0].params).toHaveLength(10);
    // Patch order in the COALESCE list: id, clientId, clientName, paymentTerms, discount,
    // discountType, status, expirationDate, notes, then the WHERE id.
    expect(exec.calls[0].params[6]).toBe('accepted'); // status
    expect(exec.calls[0].params[9]).toBe('co-1'); // where id
  });

  test('returns null when no row updated', async () => {
    exec.enqueue({ rows: [] });
    expect(await clientOffersRepo.update('co-x', { status: 'accepted' }, testDb)).toBeNull();
  });
});

describe('replaceItems', () => {
  test('issues DELETE then a single multi-row INSERT and preserves order', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({
      rows: [
        { ...itemRawRow, id: 'a' },
        { ...itemRawRow, id: 'b' },
      ],
    });
    const items: clientOffersRepo.NewClientOfferItem[] = [
      {
        id: 'a',
        productId: 'p-1',
        productName: 'A',
        quantity: 1,
        unitPrice: 5,
        productCost: 2,
        productMolPercentage: null,
        discount: 0,
        note: null,
        supplierQuoteId: null,
        supplierQuoteItemId: null,
        supplierQuoteSupplierName: null,
        supplierQuoteUnitPrice: null,
        unitType: 'unit',
      },
      {
        id: 'b',
        productId: null,
        productName: 'B',
        quantity: 2,
        unitPrice: 6,
        productCost: 3,
        productMolPercentage: null,
        discount: 1,
        note: null,
        supplierQuoteId: null,
        supplierQuoteItemId: null,
        supplierQuoteSupplierName: null,
        supplierQuoteUnitPrice: null,
        unitType: 'hours',
      },
    ];
    const result = await clientOffersRepo.replaceItems('co-1', items, testDb);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('delete from "customer_offer_items"');
    expect(exec.calls[1].sql).toContain('INSERT INTO customer_offer_items');
    expect(exec.calls[1].sql).toContain(
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15), ($16',
    );
    expect(exec.calls[1].params[0]).toBe('a');
    expect(exec.calls[1].params[15]).toBe('b'); // 15 fields per row, second row starts at index 15
    expect(result.map((i) => i.id)).toEqual(['a', 'b']);
  });

  test('with empty items skips the INSERT', async () => {
    exec.enqueue({ rows: [] });
    const result = await clientOffersRepo.replaceItems('co-1', [], testDb);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].sql).toContain('delete from');
    expect(result).toEqual([]);
  });
});

describe('deleteById', () => {
  test('returns true when row deleted', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    expect(await clientOffersRepo.deleteById('co-1', testDb)).toBe(true);
  });

  test('returns false when no row matched', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    expect(await clientOffersRepo.deleteById('co-x', testDb)).toBe(false);
  });
});
