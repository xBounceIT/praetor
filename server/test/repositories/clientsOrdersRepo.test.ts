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
// supplier_sale_id, supplier_sale_item_id, supplier_sale_supplier_name, duration_months,
// duration_unit, created_at
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
  1,
  'months',
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

  test('update writes only provided columns, never id (issue #621), includes id in WHERE', async () => {
    exec.enqueue({ rows: [orderRow()] });
    await repo.update('co-1', { status: 'confirmed' }, testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    const setClause = sql.slice(sql.indexOf(' set ') + 5, sql.indexOf(' where '));
    expect(sql).toContain('update "sales"');
    expect(setClause).not.toContain('coalesce');
    expect(setClause).toContain('"status"');
    expect(setClause).not.toContain('"notes"');
    expect(setClause).not.toContain('"linked_offer_id"');
    expect(setClause).not.toMatch(/"id"\s*=/);
    expect(exec.calls[0].params).toContain('confirmed');
    expect(exec.calls[0].params).toContain('co-1');
  });

  test('explicit null notes and links clear nullable columns', async () => {
    exec.enqueue({ rows: [orderRow()] });
    await repo.update('co-1', { linkedOfferId: null, linkedQuoteId: null, notes: null }, testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    const setClause = sql.slice(sql.indexOf(' set ') + 5, sql.indexOf(' where '));
    expect(setClause).toContain('"linked_offer_id"');
    expect(setClause).toContain('"linked_quote_id"');
    expect(setClause).toContain('"notes"');
    expect(setClause).not.toContain('coalesce');
    expect(exec.calls[0].params.filter((param) => param === null)).toHaveLength(3);
  });

  test('empty patch only updates updated_at', async () => {
    exec.enqueue({ rows: [orderRow()] });
    await repo.update('co-1', {}, testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    const setClause = sql.slice(sql.indexOf(' set ') + 5, sql.indexOf(' where '));
    expect(setClause).toContain('"updated_at" = current_timestamp');
    expect(setClause).not.toContain('"notes"');
    expect(setClause).not.toContain('coalesce');
  });

  test('update returns null when no row matches', async () => {
    exec.enqueue({ rows: [] });
    expect(await repo.update('co-x', { status: 'confirmed' }, testDb)).toBeNull();
  });
});

describe('rename', () => {
  test('issues a dedicated UPDATE that sets the id column and returns the mapped order', async () => {
    exec.enqueue({ rows: [orderRow({ 0: 'co-2' })] });
    const result = await repo.rename('co-1', 'co-2', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('update "sales"');
    expect(sql).toMatch(/set[^"]*"id"\s*=/);
    expect(sql).toContain('current_timestamp');
    expect(exec.calls[0].params).toContain('co-2'); // new id
    expect(exec.calls[0].params).toContain('co-1'); // where current id
    expect(result?.id).toBe('co-2');
  });

  test('returns null when no row matched currentId', async () => {
    exec.enqueue({ rows: [] });
    expect(await repo.rename('co-x', 'co-y', testDb)).toBeNull();
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
    durationMonths: 1,
    durationUnit: 'months',
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
          durationMonths: 3,
          durationUnit: 'months',
        },
        {
          id: 'ssi-b',
          productId: 'p-2',
          productName: 'B',
          quantity: 2,
          unitPrice: 6,
          note: 'n',
          durationMonths: 24,
          durationUnit: 'years',
        },
      ],
      testDb,
    );
    expect(exec.calls[0].sql.toLowerCase()).toContain('insert into "supplier_sale_items"');
    expect(exec.calls[0].params).toContain('ssi-a');
    expect(exec.calls[0].params).toContain('ssi-b');
    expect(exec.calls[0].params).toContain('so-1');
    // Duration carried onto the auto-created order line (issue #776).
    expect(exec.calls[0].params).toContain(3);
    expect(exec.calls[0].params).toContain(24);
    expect(exec.calls[0].params).toContain('years');
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

describe('listAllItems', () => {
  test('orders items by created_at ASC and maps fields', async () => {
    exec.enqueue({ rows: [itemRow()] });
    const result = await repo.listAllItems(testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('from "sale_items"');
    expect(exec.calls[0].sql.toLowerCase()).toContain('order by "sale_items"."created_at"');
    expect(result[0].id).toBe('si-1');
    expect(result[0].orderId).toBe('co-1');
    expect(result[0].quantity).toBe(2);
    expect(result[0].durationMonths).toBe(1);
    expect(result[0].durationUnit).toBe('months');
  });

  test('maps a multi-month duration through to durationMonths (issue #757)', async () => {
    exec.enqueue({ rows: [itemRow({ 18: 12 })] });
    const result = await repo.listAllItems(testDb);
    expect(result[0].durationMonths).toBe(12);
  });

  test('maps duration_unit through to durationUnit (issue #757)', async () => {
    exec.enqueue({ rows: [itemRow({ 19: 'years' })] });
    const result = await repo.listAllItems(testDb);
    expect(result[0].durationUnit).toBe('years');
  });
});

describe('existsById', () => {
  test('returns true when matching row exists', async () => {
    exec.enqueue({ rows: [['co-1']] });
    expect(await repo.existsById('co-1', testDb)).toBe(true);
  });

  test('returns false when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await repo.existsById('co-x', testDb)).toBe(false);
  });
});

describe('findIdConflict', () => {
  test('binds both ids and excludes self', async () => {
    exec.enqueue({ rows: [['co-2']] });
    const result = await repo.findIdConflict('co-2', 'co-1', testDb);
    expect(exec.calls[0].params).toEqual(['co-2', 'co-1']);
    expect(result).toBe(true);
  });

  test('returns false when no conflict', async () => {
    exec.enqueue({ rows: [] });
    expect(await repo.findIdConflict('co-2', 'co-1', testDb)).toBe(false);
  });
});

describe('findExisting', () => {
  test('returns mapped existing order when found', async () => {
    exec.enqueue({
      rows: [['co-1', null, null, 'c-1', 'Acme', 'net30', '5', 'currency', 'draft', null]],
    });
    const result = await repo.findExisting('co-1', testDb);
    expect(result).toEqual({
      id: 'co-1',
      linkedQuoteId: null,
      linkedOfferId: null,
      clientId: 'c-1',
      clientName: 'Acme',
      paymentTerms: 'net30',
      discount: 5,
      discountType: 'currency',
      status: 'draft',
      notes: null,
    });
  });

  test('coerces unknown discountType to percentage', async () => {
    exec.enqueue({
      rows: [['co-1', null, null, 'c-1', 'Acme', 'net30', '0', 'weird', 'draft', null]],
    });
    const result = await repo.findExisting('co-1', testDb);
    expect(result?.discountType).toBe('percentage');
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await repo.findExisting('co-x', testDb)).toBeNull();
  });
});

describe('findStatusAndClientName', () => {
  test('returns status and clientName when found', async () => {
    exec.enqueue({ rows: [['draft', 'Acme']] });
    expect(await repo.findStatusAndClientName('co-1', testDb)).toEqual({
      status: 'draft',
      clientName: 'Acme',
    });
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await repo.findStatusAndClientName('co-x', testDb)).toBeNull();
  });
});

describe('findItemsForOrder', () => {
  test('selects items filtered by orderId and maps them', async () => {
    exec.enqueue({ rows: [itemRow()] });
    const result = await repo.findItemsForOrder('co-1', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('from "sale_items"');
    expect(exec.calls[0].params).toContain('co-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('si-1');
  });

  test('orders rows deterministically by created_at then id', async () => {
    exec.enqueue({ rows: [] });
    await repo.findItemsForOrder('co-1', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('order by');
    expect(sql).toMatch(/"created_at".*,.*"id"/);
  });
});

describe('findFullForSnapshot', () => {
  test('returns order and items when order exists', async () => {
    exec.enqueue({ rows: [orderRow()] });
    exec.enqueue({ rows: [itemRow()] });
    const result = await repo.findFullForSnapshot('co-1', testDb);
    expect(result).not.toBeNull();
    expect(result?.order.id).toBe('co-1');
    expect(result?.items).toHaveLength(1);
  });

  test('returns null when order not found', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    expect(await repo.findFullForSnapshot('co-x', testDb)).toBeNull();
  });
});

describe('restoreSnapshotOrder', () => {
  test('updates the order with snapshot fields and returns mapped order', async () => {
    exec.enqueue({ rows: [orderRow()] });
    const result = await repo.restoreSnapshotOrder(
      'co-1',
      {
        clientId: 'c-1',
        clientName: 'Acme',
        paymentTerms: 'net30',
        discount: 7,
        discountType: 'percentage',
        status: 'confirmed',
        notes: 'restored',
      },
      testDb,
    );
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('update "sales"');
    expect(sql).toContain('current_timestamp');
    expect(exec.calls[0].params).toContain('confirmed');
    expect(exec.calls[0].params).toContain('Acme');
    expect(exec.calls[0].params).toContain('co-1');
    expect(result?.id).toBe('co-1');
  });

  test('falls back to "immediate" paymentTerms when snapshot.paymentTerms is null', async () => {
    exec.enqueue({ rows: [orderRow()] });
    await repo.restoreSnapshotOrder(
      'co-1',
      {
        clientId: 'c-1',
        clientName: 'Acme',
        paymentTerms: null,
        discount: 0,
        discountType: 'percentage',
        status: 'draft',
        notes: null,
      },
      testDb,
    );
    expect(exec.calls[0].params).toContain('immediate');
  });

  test('returns null when no row updated', async () => {
    exec.enqueue({ rows: [] });
    const result = await repo.restoreSnapshotOrder(
      'co-x',
      {
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
    expect(result).toBeNull();
  });

  // Regression: B15. When the snapshot carries linkedQuoteId / linkedOfferId, the restore
  // path must write them back to the sales row so the historical link is preserved.
  test('writes linkedQuoteId / linkedOfferId when the snapshot carries them', async () => {
    exec.enqueue({ rows: [orderRow()] });
    await repo.restoreSnapshotOrder(
      'co-1',
      {
        clientId: 'c-1',
        clientName: 'Acme',
        paymentTerms: 'net30',
        discount: 0,
        discountType: 'percentage',
        status: 'draft',
        notes: null,
        linkedQuoteId: 'cq-link',
        linkedOfferId: 'co-link',
      },
      testDb,
    );
    const sql = exec.calls[0].sql.toLowerCase();
    const setClause = sql.slice(sql.indexOf(' set ') + 5, sql.indexOf(' where '));
    expect(setClause).toContain('"linked_quote_id"');
    expect(setClause).toContain('"linked_offer_id"');
    expect(exec.calls[0].params).toContain('cq-link');
    expect(exec.calls[0].params).toContain('co-link');
  });

  test('explicit null linkedQuoteId / linkedOfferId clears the columns', async () => {
    exec.enqueue({ rows: [orderRow()] });
    await repo.restoreSnapshotOrder(
      'co-1',
      {
        clientId: 'c-1',
        clientName: 'Acme',
        paymentTerms: 'net30',
        discount: 0,
        discountType: 'percentage',
        status: 'draft',
        notes: null,
        linkedQuoteId: null,
        linkedOfferId: null,
      },
      testDb,
    );
    const sql = exec.calls[0].sql.toLowerCase();
    const setClause = sql.slice(sql.indexOf(' set ') + 5, sql.indexOf(' where '));
    expect(setClause).toContain('"linked_quote_id"');
    expect(setClause).toContain('"linked_offer_id"');
  });

  // Legacy snapshots stored before the schema change do not carry linkedQuoteId/linkedOfferId
  // at all - in that case the columns must not be touched (overwriting with `null` would wipe
  // a link that is still valid on the live row). Asserting via the absence of the columns in
  // the SET clause specifically (the RETURNING clause projects them regardless).
  test('omits linkedQuoteId / linkedOfferId from the SET clause when the snapshot omits them', async () => {
    exec.enqueue({ rows: [orderRow()] });
    await repo.restoreSnapshotOrder(
      'co-1',
      {
        clientId: 'c-1',
        clientName: 'Acme',
        paymentTerms: 'net30',
        discount: 0,
        discountType: 'percentage',
        status: 'draft',
        notes: null,
        // linkedQuoteId / linkedOfferId intentionally absent (legacy snapshot shape).
      },
      testDb,
    );
    const sql = exec.calls[0].sql.toLowerCase();
    // Carve out just the SET clause (between "set " and " where").
    const setClause = sql.slice(sql.indexOf(' set ') + 5, sql.indexOf(' where '));
    expect(setClause).not.toContain('"linked_quote_id"');
    expect(setClause).not.toContain('"linked_offer_id"');
  });
});
