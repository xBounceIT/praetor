import { beforeEach, describe, expect, test } from 'bun:test';
import * as repo from '../../repositories/clientsOrdersRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

const orderRow = {
  id: 'co-1',
  linkedQuoteId: null,
  linkedOfferId: null,
  clientId: 'c-1',
  clientName: 'Acme',
  paymentTerms: 'net30',
  discount: '0',
  discountType: 'percentage',
  status: 'draft',
  notes: null,
  createdAt: 1735689600000,
  updatedAt: 1735689700000,
};

const itemRow = {
  id: 'si-1',
  orderId: 'co-1',
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
  supplierSaleId: null,
  supplierSaleItemId: null,
  supplierSaleSupplierName: null,
  unitType: 'unit',
  note: null,
  discount: '0',
};

describe('listAll', () => {
  test('orders by created_at DESC', async () => {
    exec.enqueue({ rows: [orderRow] });
    const result = await repo.listAll(exec);
    expect(exec.calls[0].sql).toContain('FROM sales');
    expect(exec.calls[0].sql).toContain('ORDER BY created_at DESC');
    expect(result[0].id).toBe('co-1');
  });
});

describe('findOfferDetails', () => {
  test('returns offer with linkedQuoteId and status', async () => {
    exec.enqueue({
      rows: [{ id: 'co-1', linkedQuoteId: 'cq-1', status: 'accepted' }],
    });
    const result = await repo.findOfferDetails('co-1', exec);
    expect(result).toEqual({ id: 'co-1', linkedQuoteId: 'cq-1', status: 'accepted' });
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await repo.findOfferDetails('missing', exec)).toBeNull();
  });
});

describe('findExistingForOffer', () => {
  test('omits id <> $2 when no excludeOrderId', async () => {
    exec.enqueue({ rows: [] });
    await repo.findExistingForOffer('co-1', null, exec);
    expect(exec.calls[0].sql).not.toContain('id <> $2');
    expect(exec.calls[0].params).toEqual(['co-1']);
  });

  test('includes id <> $2 when excludeOrderId provided', async () => {
    exec.enqueue({ rows: [{ id: 's-2' }] });
    const result = await repo.findExistingForOffer('co-1', 's-1', exec);
    expect(exec.calls[0].sql).toContain('id <> $2');
    expect(result).toBe('s-2');
  });
});

describe('create / update', () => {
  test('create inserts 10 params', async () => {
    exec.enqueue({ rows: [orderRow] });
    await repo.create(
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
      exec,
    );
    expect(exec.calls[0].sql).toContain('INSERT INTO sales');
    expect(exec.calls[0].params).toHaveLength(10);
  });

  test('update passes 11 params with id at the end', async () => {
    exec.enqueue({ rows: [orderRow] });
    await repo.update('co-1', { status: 'confirmed' }, exec);
    expect(exec.calls[0].params).toHaveLength(11);
    expect(exec.calls[0].params[10]).toBe('co-1');
  });

  test('update returns null when no row matches', async () => {
    exec.enqueue({ rows: [] });
    expect(await repo.update('co-x', { status: 'confirmed' }, exec)).toBeNull();
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

  test('insertItems issues a single bulk INSERT with 18 fields per row', async () => {
    exec.enqueue({ rows: [itemRow] });
    await repo.insertItems('co-1', [sampleItem], exec);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].sql).toContain('INSERT INTO sale_items');
    expect(exec.calls[0].params).toHaveLength(18);
  });

  test('insertItems with empty array skips INSERT', async () => {
    expect(await repo.insertItems('co-1', [], exec)).toEqual([]);
    expect(exec.calls).toHaveLength(0);
  });

  test('replaceItems issues DELETE then INSERT', async () => {
    exec.enqueue({ rows: [] }); // DELETE
    exec.enqueue({ rows: [itemRow] }); // INSERT
    await repo.replaceItems('co-1', [sampleItem], exec);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('DELETE FROM sale_items');
    expect(exec.calls[1].sql).toContain('INSERT INTO sale_items');
  });
});

describe('supplier-order auto-creation flow (transaction injection)', () => {
  test('createSupplierOrder uses passed exec for the INSERT', async () => {
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
      exec,
    );
    expect(exec.calls[0].sql).toContain('INSERT INTO supplier_sales');
    expect(exec.calls[0].sql).toContain("'draft'");
    expect(exec.calls[0].params).toEqual(['so-1', 'sq-1', 'sup-1', 'Vendor', 'immediate', null]);
  });

  test('bulkInsertSupplierOrderItems builds 7-field placeholders per row', async () => {
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
      exec,
    );
    expect(exec.calls[0].sql).toContain('INSERT INTO supplier_sale_items');
    expect(exec.calls[0].sql).toContain('($1, $2, $3, $4, $5, $6, $7), ($8');
    expect(exec.calls[0].params).toHaveLength(14);
    expect(exec.calls[0].params[0]).toBe('ssi-a');
    expect(exec.calls[0].params[7]).toBe('ssi-b');
  });

  test('bulkInsertSupplierOrderItems is a no-op for empty items', async () => {
    await repo.bulkInsertSupplierOrderItems('so-1', [], exec);
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
      exec,
    );
    expect(exec.calls[0].sql).toContain('UPDATE sale_items');
    expect(exec.calls[0].sql).toContain('supplier_sale_id = $1');
    expect(exec.calls[0].sql).toContain('supplier_sale_supplier_name = $2');
    expect(exec.calls[0].params).toEqual(['so-1', 'Vendor', 'co-1', 'sq-1']);
  });

  test('mapSaleItemsToSupplierItems uses VALUES(...) join with $1/$2 anchors', async () => {
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
      exec,
    );
    expect(exec.calls[0].sql).toContain(
      'FROM (VALUES ($3, $4), ($5, $6)) v(quote_item_id, sale_item_id)',
    );
    expect(exec.calls[0].params).toEqual(['co-1', 'sq-1', 'sqi-a', 'ssi-a', 'sqi-b', 'ssi-b']);
  });

  test('mapSaleItemsToSupplierItems is a no-op for empty mappings', async () => {
    await repo.mapSaleItemsToSupplierItems(
      { orderId: 'co-1', supplierQuoteId: 'sq-1', mappings: [] },
      exec,
    );
    expect(exec.calls).toHaveLength(0);
  });
});

describe('deleteById', () => {
  test('returns true when row deleted', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    expect(await repo.deleteById('co-1', exec)).toBe(true);
  });

  test('returns false when no row matched', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    expect(await repo.deleteById('co-x', exec)).toBe(false);
  });
});
