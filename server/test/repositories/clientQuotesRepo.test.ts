import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as clientQuotesRepo from '../../repositories/clientQuotesRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// QUOTE_LIST_PROJECTION column order:
// id, linkedOfferId (subquery), clientId, clientName, paymentTerms, discount, discountType,
// status, expirationDate, notes, createdAt, updatedAt
const QUOTE_BASE: readonly unknown[] = [
  'cq-1',
  null,
  'c-1',
  'Acme',
  'net30',
  '10',
  'percentage',
  'draft',
  '2026-06-01',
  null,
  new Date('2026-04-01T00:00:00Z'),
  new Date('2026-04-01T00:01:00Z'),
];
const quoteRow = (overrides: Record<number, unknown> = {}) => makeRow(QUOTE_BASE, overrides);

// quote_items column order (from schema):
// id, quote_id, product_id, product_name, quantity, unit_price, product_cost,
// product_mol_percentage, supplier_quote_id, supplier_quote_item_id,
// supplier_quote_supplier_name, supplier_quote_unit_price, discount, note, unit_type,
// created_at
const ITEM_BASE: readonly unknown[] = [
  'qi-1',
  'cq-1',
  'p-1',
  'Widget',
  '2',
  '10',
  '5',
  '20',
  null,
  null,
  null,
  null,
  '0',
  null,
  'unit',
  new Date('2026-04-01T00:00:00Z'),
];
const itemRow = (overrides: Record<number, unknown> = {}) => makeRow(ITEM_BASE, overrides);

describe('listAll', () => {
  test('embeds the linkedOfferId correlated subquery and orders DESC', async () => {
    exec.enqueue({ rows: [quoteRow({ 1: 'co-1' })] });
    const result = await clientQuotesRepo.listAll(testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('from customer_offers co');
    expect(exec.calls[0].sql.toLowerCase()).toContain('co.linked_quote_id');
    expect(exec.calls[0].sql.toLowerCase()).toContain('order by "quotes"."created_at" desc');
    expect(result[0].linkedOfferId).toBe('co-1');
  });
});

describe('listAllItems', () => {
  test('returns mapped items in created_at order', async () => {
    exec.enqueue({ rows: [itemRow()] });
    const result = await clientQuotesRepo.listAllItems(testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('order by "quote_items"."created_at"');
    expect(result[0].quantity).toBe(2);
    expect(result[0].productCost).toBe(5);
    expect(result[0].productMolPercentage).toBe(20);
  });

  test('null productMolPercentage stays null in output', async () => {
    exec.enqueue({ rows: [itemRow({ 7: null })] });
    const result = await clientQuotesRepo.listAllItems(testDb);
    expect(result[0].productMolPercentage).toBeNull();
  });
});

describe('existsById / findIdConflict', () => {
  test('existsById returns true on match', async () => {
    exec.enqueue({ rows: [['cq-1']] });
    expect(await clientQuotesRepo.existsById('cq-1', testDb)).toBe(true);
  });

  test('findIdConflict passes both ids in params', async () => {
    exec.enqueue({ rows: [] });
    await clientQuotesRepo.findIdConflict('new', 'cur', testDb);
    expect(exec.calls[0].params).toContain('new');
    expect(exec.calls[0].params).toContain('cur');
  });
});

describe('findCurrentForUpdate', () => {
  test('returns parsed status and discount fields', async () => {
    exec.enqueue({ rows: [['sent', '15.5', 'currency']] });
    const result = await clientQuotesRepo.findCurrentForUpdate('cq-1', testDb);
    expect(result).toEqual({ status: 'sent', discount: 15.5, discountType: 'currency' });
  });

  test('defaults discountType to percentage when null', async () => {
    exec.enqueue({ rows: [['draft', 0, null]] });
    const result = await clientQuotesRepo.findCurrentForUpdate('cq-1', testDb);
    expect(result?.discountType).toBe('percentage');
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await clientQuotesRepo.findCurrentForUpdate('cq-x', testDb)).toBeNull();
  });
});

describe('linked-sale guards', () => {
  test('findLinkedOfferId returns id from customer_offers', async () => {
    exec.enqueue({ rows: [['co-1']] });
    expect(await clientQuotesRepo.findLinkedOfferId('cq-1', testDb)).toBe('co-1');
    expect(exec.calls[0].sql.toLowerCase()).toContain('from "customer_offers"');
    expect(exec.calls[0].params).toContain('cq-1');
  });

  test('findNonDraftLinkedSale filters out draft sales', async () => {
    exec.enqueue({ rows: [['s-1']] });
    await clientQuotesRepo.findNonDraftLinkedSale('cq-1', testDb);
    expect(exec.calls[0].params).toContain('cq-1');
    expect(exec.calls[0].params).toContain('draft');
  });

  test('deleteDraftSalesForQuote scopes the delete to draft sales', async () => {
    exec.enqueue({ rows: [], rowCount: 2 });
    await clientQuotesRepo.deleteDraftSalesForQuote('cq-1', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('delete from "sales"');
    expect(exec.calls[0].params).toContain('cq-1');
    expect(exec.calls[0].params).toContain('draft');
  });
});

describe('findItemSnapshotsForQuote', () => {
  test('maps snapshot row fields with parsed numbers and unitType normalization', async () => {
    // Projected columns in order:
    // id, productId, productCost, productMolPercentage, supplierQuoteId, supplierQuoteItemId,
    // supplierQuoteSupplierName, supplierQuoteUnitPrice, unitType
    exec.enqueue({
      rows: [['qi-1', 'p-1', '5', '20', null, null, null, null, null]],
    });
    const result = await clientQuotesRepo.findItemSnapshotsForQuote('cq-1', testDb);
    expect(result[0]).toEqual({
      id: 'qi-1',
      productId: 'p-1',
      productCost: 5,
      productMolPercentage: 20,
      supplierQuoteId: null,
      supplierQuoteItemId: null,
      supplierQuoteSupplierName: null,
      supplierQuoteUnitPrice: null,
      unitType: 'hours', // null normalized to "hours" by normalizeUnitType
    });
  });
});

describe('findItemTotals', () => {
  test('returns parsed numeric totals', async () => {
    exec.enqueue({
      rows: [
        ['2', '10', '5'],
        [1, 20, null],
      ],
    });
    const result = await clientQuotesRepo.findItemTotals('cq-1', testDb);
    expect(result).toEqual([
      { quantity: 2, unitPrice: 10, discount: 5 },
      { quantity: 1, unitPrice: 20, discount: 0 },
    ]);
  });
});

describe('create', () => {
  test('inserts and returns mapped quote', async () => {
    exec.enqueue({ rows: [quoteRow()] });
    const result = await clientQuotesRepo.create(
      {
        id: 'cq-1',
        clientId: 'c-1',
        clientName: 'Acme',
        paymentTerms: 'net30',
        discount: 10,
        discountType: 'percentage',
        status: 'draft',
        expirationDate: '2026-06-01',
        notes: null,
      },
      testDb,
    );
    expect(exec.calls[0].sql.toLowerCase()).toContain('insert into "quotes"');
    expect(result.id).toBe('cq-1');
    expect(result.discount).toBe(10);
  });
});

describe('update', () => {
  test('uses COALESCE-per-column and includes id in WHERE', async () => {
    exec.enqueue({ rows: [quoteRow()] });
    await clientQuotesRepo.update('cq-1', { status: 'accepted' }, testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('update "quotes"');
    expect(sql).toContain('coalesce');
    expect(exec.calls[0].params).toContain('accepted');
    expect(exec.calls[0].params).toContain('cq-1');
  });

  test('returns null when no row updated', async () => {
    exec.enqueue({ rows: [] });
    expect(await clientQuotesRepo.update('cq-x', { status: 'accepted' }, testDb)).toBeNull();
  });
});

describe('replaceItems', () => {
  test('issues DELETE then bulk INSERT and preserves order', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({
      rows: [itemRow({ 0: 'a' }), itemRow({ 0: 'b' })],
    });
    const items: clientQuotesRepo.NewClientQuoteItem[] = [
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
        productMolPercentage: 25,
        discount: 1,
        note: 'note-b',
        supplierQuoteId: 'sq-1',
        supplierQuoteItemId: 'sqi-1',
        supplierQuoteSupplierName: 'Vendor',
        supplierQuoteUnitPrice: 4,
        unitType: 'hours',
      },
    ];
    const result = await clientQuotesRepo.replaceItems('cq-1', items, testDb);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql.toLowerCase()).toContain('delete from "quote_items"');
    expect(exec.calls[1].sql.toLowerCase()).toContain('insert into "quote_items"');
    expect(exec.calls[1].params).toContain('a');
    expect(exec.calls[1].params).toContain('b');
    expect(result.map((i) => i.id)).toEqual(['a', 'b']);
  });

  test('with empty items skips the INSERT', async () => {
    exec.enqueue({ rows: [] });
    const result = await clientQuotesRepo.replaceItems('cq-1', [], testDb);
    expect(exec.calls).toHaveLength(1);
    expect(result).toEqual([]);
  });
});
