import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as repo from '../../repositories/clientsOrdersRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// `sales` columns in schema declaration order:
// id, linked_quote_id, linked_offer_id, client_id, client_name, payment_terms, discount,
// discount_type, status, notes, created_at, updated_at
const ORDER_BASE: readonly unknown[] = [
  'co-1',
  null,
  null,
  'c-1',
  'Acme',
  'net30',
  '0',
  'percentage',
  'draft',
  null,
  new Date('2026-04-01T00:00:00Z'),
  new Date('2026-04-01T00:01:00Z'),
];
const orderRow = (overrides: Record<number, unknown> = {}) => makeRow(ORDER_BASE, overrides);

// `sale_items` columns in schema declaration order:
// id, sale_id, product_id, product_name, quantity, unit_price, product_cost,
// product_mol_percentage, discount, unit_type, note, supplier_quote_id,
// supplier_quote_item_id, supplier_quote_supplier_name, supplier_quote_unit_price,
// supplier_sale_id, supplier_sale_item_id, supplier_sale_supplier_name, created_at
const ITEM_BASE: readonly unknown[] = [
  'si-1',
  'co-1',
  'p-1',
  'Widget',
  '2',
  '10',
  '5',
  null,
  '0',
  'unit',
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  new Date('2026-04-01T00:00:00Z'),
];
const itemRow = (overrides: Record<number, unknown> = {}) => makeRow(ITEM_BASE, overrides);

describe('listAll', () => {
  test('orders by created_at DESC', async () => {
    exec.enqueue({ rows: [orderRow()] });
    const result = await repo.listAll(testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('from "sales"');
    expect(exec.calls[0].sql.toLowerCase()).toContain('order by "sales"."created_at" desc');
    expect(result[0].id).toBe('co-1');
  });
});

describe('findOfferDetails', () => {
  test('returns offer with linkedQuoteId and status', async () => {
    exec.enqueue({ rows: [['co-1', 'cq-1', 'accepted']] });
    const result = await repo.findOfferDetails('co-1', testDb);
    expect(result).toEqual({ id: 'co-1', linkedQuoteId: 'cq-1', status: 'accepted' });
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await repo.findOfferDetails('missing', testDb)).toBeNull();
  });
});

describe('findExistingForOffer', () => {
  test('omits the exclude predicate when no excludeOrderId', async () => {
    exec.enqueue({ rows: [] });
    await repo.findExistingForOffer('co-1', null, testDb);
    expect(exec.calls[0].params).toContain('co-1');
    // No exclude id is passed.
    expect(exec.calls[0].params).not.toContain('s-1');
  });

  test('includes the exclude predicate when excludeOrderId provided', async () => {
    exec.enqueue({ rows: [['s-2']] });
    const result = await repo.findExistingForOffer('co-1', 's-1', testDb);
    expect(exec.calls[0].params).toContain('co-1');
    expect(exec.calls[0].params).toContain('s-1');
    expect(result).toBe('s-2');
  });
});

describe('create / update', () => {
  test('create inserts and returns the mapped order', async () => {
    exec.enqueue({ rows: [orderRow()] });
    const result = await repo.create(
      {
        id: 'co-1',
        linkedQuoteId: null,
        linkedOfferId: null,
        clientId: 'c-1',
        clientName: 'Acme',
        paymentTerms: 'net30',
        discount: 0,
        discountType: 'percentage',
        status: 'draft',
        notes: null,
      },
      testDb,
    );
    expect(exec.calls[0].sql.toLowerCase()).toContain('insert into "sales"');
    expect(result.id).toBe('co-1');
  });

  test('update uses COALESCE-per-column and includes id in WHERE', async () => {
    exec.enqueue({ rows: [orderRow()] });
    await repo.update('co-1', { status: 'confirmed' }, testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('update "sales"');
    expect(sql).toContain('coalesce');
    expect(exec.calls[0].params).toContain('confirmed');
    expect(exec.calls[0].params).toContain('co-1');
  });

  test('update returns null when no row matches', async () => {
    exec.enqueue({ rows: [] });
    expect(await repo.update('co-x', { status: 'confirmed' }, testDb)).toBeNull();
  });
});

describe('insertItems / replaceItems', () => {
  const sampleItem: repo.NewClientOrderItem = {
    id: 'si-1',
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
    supplierSaleId: null,
    supplierSaleItemId: null,
    supplierSaleSupplierName: null,
    unitType: 'unit',
  };

  test('insertItems issues a single bulk INSERT', async () => {
    exec.enqueue({ rows: [itemRow()] });
    await repo.insertItems('co-1', [sampleItem], testDb);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].sql.toLowerCase()).toContain('insert into "sale_items"');
    expect(exec.calls[0].params).toContain('si-1');
    expect(exec.calls[0].params).toContain('co-1');
  });

  test('insertItems with empty array skips INSERT', async () => {
    expect(await repo.insertItems('co-1', [], testDb)).toEqual([]);
    expect(exec.calls).toHaveLength(0);
  });

  test('replaceItems issues DELETE then INSERT', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [itemRow()] });
    await repo.replaceItems('co-1', [sampleItem], testDb);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql.toLowerCase()).toContain('delete from "sale_items"');
    expect(exec.calls[1].sql.toLowerCase()).toContain('insert into "sale_items"');
  });
});

describe('supplier-order auto-creation flow', () => {
  test('createSupplierOrder inserts into supplier_sales with status=draft', async () => {
    exec.enqueue({ rows: [] });
    await repo.createSupplierOrder(
      {
        id: 'so-1',
        linkedQuoteId: 'sq-1',
        supplierId: 'sup-1',
        supplierName: 'Vendor',
        paymentTerms: 'immediate',
        notes: null,
      },
      testDb,
    );
    expect(exec.calls[0].sql.toLowerCase()).toContain('insert into "supplier_sales"');
    expect(exec.calls[0].params).toContain('so-1');
    expect(exec.calls[0].params).toContain('sq-1');
    expect(exec.calls[0].params).toContain('sup-1');
    expect(exec.calls[0].params).toContain('Vendor');
    expect(exec.calls[0].params).toContain('immediate');
    expect(exec.calls[0].params).toContain('draft');
  });

  test('bulkInsertSupplierOrderItems issues a single multi-row INSERT', async () => {
    exec.enqueue({ rows: [] });
    await repo.bulkInsertSupplierOrderItems(
      'so-1',
      [
        {
          id: 'ssi-a',
          productId: 'p-1',
          productName: 'A',
          quantity: 1,
          unitPrice: 5,
          note: null,
        },
        {
          id: 'ssi-b',
          productId: 'p-2',
          productName: 'B',
          quantity: 2,
          unitPrice: 6,
          note: 'n',
        },
      ],
      testDb,
    );
    expect(exec.calls[0].sql.toLowerCase()).toContain('insert into "supplier_sale_items"');
    expect(exec.calls[0].params).toContain('ssi-a');
    expect(exec.calls[0].params).toContain('ssi-b');
    expect(exec.calls[0].params).toContain('so-1');
  });

  test('bulkInsertSupplierOrderItems is a no-op for empty items', async () => {
    await repo.bulkInsertSupplierOrderItems('so-1', [], testDb);
    expect(exec.calls).toHaveLength(0);
  });

  test('linkSaleItemsToSupplierOrder sets supplier_sale_id and name on matching sale_items', async () => {
    exec.enqueue({ rows: [], rowCount: 2 });
    await repo.linkSaleItemsToSupplierOrder(
      {
        orderId: 'co-1',
        supplierQuoteId: 'sq-1',
        supplierOrderId: 'so-1',
        supplierName: 'Vendor',
      },
      testDb,
    );
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('update "sale_items"');
    expect(sql).toContain('"supplier_sale_id"');
    expect(sql).toContain('"supplier_sale_supplier_name"');
    expect(exec.calls[0].params).toContain('so-1');
    expect(exec.calls[0].params).toContain('Vendor');
    expect(exec.calls[0].params).toContain('co-1');
    expect(exec.calls[0].params).toContain('sq-1');
  });

  test('mapSaleItemsToSupplierItems uses VALUES(...) join with positional params', async () => {
    exec.enqueue({ rows: [], rowCount: 2 });
    await repo.mapSaleItemsToSupplierItems(
      {
        orderId: 'co-1',
        supplierQuoteId: 'sq-1',
        mappings: [
          { quoteItemId: 'sqi-a', saleItemId: 'ssi-a' },
          { quoteItemId: 'sqi-b', saleItemId: 'ssi-b' },
        ],
      },
      testDb,
    );
    const sql = exec.calls[0].sql;
    expect(sql).toContain('FROM (VALUES');
    expect(sql).toContain('v(quote_item_id, sale_item_id)');
    expect(exec.calls[0].params).toContain('co-1');
    expect(exec.calls[0].params).toContain('sq-1');
    expect(exec.calls[0].params).toContain('sqi-a');
    expect(exec.calls[0].params).toContain('ssi-a');
    expect(exec.calls[0].params).toContain('sqi-b');
    expect(exec.calls[0].params).toContain('ssi-b');
  });

  test('mapSaleItemsToSupplierItems is a no-op for empty mappings', async () => {
    await repo.mapSaleItemsToSupplierItems(
      { orderId: 'co-1', supplierQuoteId: 'sq-1', mappings: [] },
      testDb,
    );
    expect(exec.calls).toHaveLength(0);
  });
});

describe('deleteById', () => {
  test('returns true when row deleted', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    expect(await repo.deleteById('co-1', testDb)).toBe(true);
  });

  test('returns false when no row matched', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    expect(await repo.deleteById('co-x', testDb)).toBe(false);
  });
});
