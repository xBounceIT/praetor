import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as supplierOrdersRepo from '../../repositories/supplierOrdersRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// Builder fixtures match the column order of supplierSales / supplierSaleItems
// in db/schema/supplierSales.ts.
const ORDER_BASE: readonly unknown[] = [
  'so-1',
  'q-1',
  's-1',
  'Acme',
  'net30',
  '5',
  'percentage',
  'draft',
  null,
  new Date(1735689600000),
  new Date(1735689700000),
];

const orderRow = (overrides: Record<number, unknown> = {}) => makeRow(ORDER_BASE, overrides);

const ITEM_BASE: readonly unknown[] = [
  'ssi-1',
  'so-1',
  null,
  'Widget',
  '1',
  '10',
  '0',
  null,
  new Date(1735689600000),
];

const itemRow = (overrides: Record<number, unknown> = {}) => makeRow(ITEM_BASE, overrides);

describe('listAll', () => {
  test('orders by created_at DESC and maps numeric fields', async () => {
    exec.enqueue({ rows: [orderRow()] });
    const result = await supplierOrdersRepo.listAll(testDb);
    expect(exec.calls[0].sql).toContain('order by "supplier_sales"."created_at" desc');
    expect(result[0].discount).toBe(5);
    expect(result[0].discountType).toBe('percentage');
  });

  test('coerces unrecognized discountType to "percentage"', async () => {
    exec.enqueue({ rows: [orderRow({ 6: 'weird' })] });
    const result = await supplierOrdersRepo.listAll(testDb);
    expect(result[0].discountType).toBe('percentage');
  });
});

describe('findById', () => {
  test('returns mapped row', async () => {
    exec.enqueue({ rows: [orderRow()] });
    const result = await supplierOrdersRepo.findById('so-1', testDb);
    expect(result?.id).toBe('so-1');
    expect(result?.discount).toBe(5);
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierOrdersRepo.findById('so-x', testDb)).toBeNull();
  });
});

describe('findExistingForUpdate', () => {
  test('returns mapped object with linkedQuoteId', async () => {
    exec.enqueue({ rows: [['so-1', 'q-1', 's-1', 'Acme', 'draft']] });
    expect(await supplierOrdersRepo.findExistingForUpdate('so-1', testDb)).toEqual({
      id: 'so-1',
      linkedQuoteId: 'q-1',
      supplierId: 's-1',
      supplierName: 'Acme',
      status: 'draft',
    });
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierOrdersRepo.findExistingForUpdate('so-x', testDb)).toBeNull();
  });
});

describe('findLinkedInvoiceId', () => {
  test('returns id when found', async () => {
    exec.enqueue({ rows: [['inv-1']] });
    expect(await supplierOrdersRepo.findLinkedInvoiceId('so-1', testDb)).toBe('inv-1');
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierOrdersRepo.findLinkedInvoiceId('so-x', testDb)).toBeNull();
  });
});

describe('findStatusAndSupplierName', () => {
  test('returns status and supplierName', async () => {
    exec.enqueue({ rows: [['draft', 'Acme']] });
    expect(await supplierOrdersRepo.findStatusAndSupplierName('so-1', testDb)).toEqual({
      status: 'draft',
      supplierName: 'Acme',
    });
  });
});

describe('findIdConflict', () => {
  test('excludes self via <> predicate', async () => {
    exec.enqueue({ rows: [] });
    await supplierOrdersRepo.findIdConflict('new', 'cur', testDb);
    expect(exec.calls[0].sql).toContain('"id" <> $2');
    expect(exec.calls[0].params).toEqual(['new', 'cur']);
  });
});

describe('update', () => {
  test('binds patch values via COALESCE, WHERE id last', async () => {
    exec.enqueue({ rows: [orderRow()] });
    await supplierOrdersRepo.update('so-1', { status: 'sent', discount: 10 }, testDb);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('update "supplier_sales"');
    expect(sql).toContain('COALESCE');
    expect(sql).toContain('CURRENT_TIMESTAMP');
    expect(sql).toContain('"id" = $9');
    expect(exec.calls[0].params).toHaveLength(9);
    expect(exec.calls[0].params[4]).toBe('10'); // discount via numericForDb
    expect(exec.calls[0].params[6]).toBe('sent'); // status
    expect(exec.calls[0].params[8]).toBe('so-1'); // where id
  });

  test('returns null when no row updated', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierOrdersRepo.update('so-x', { status: 'sent' }, testDb)).toBeNull();
  });
});

describe('replaceItems', () => {
  test('issues DELETE then a single multi-row INSERT', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [itemRow({ 0: 'ssi-a' })] });
    const result = await supplierOrdersRepo.replaceItems(
      'so-1',
      [
        {
          id: 'ssi-a',
          productId: null,
          productName: 'A',
          quantity: 1,
          unitPrice: 5,
          discount: 0,
          note: null,
        },
      ],
      testDb,
    );
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('delete from "supplier_sale_items"');
    expect(exec.calls[1].sql).toContain('insert into "supplier_sale_items"');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ssi-a');
  });

  test('with empty items, deletes existing and skips INSERT', async () => {
    exec.enqueue({ rows: [] });
    const result = await supplierOrdersRepo.replaceItems('so-1', [], testDb);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].sql).toContain('delete from');
    expect(result).toEqual([]);
  });
});

describe('deleteById', () => {
  test('returns true when row deleted', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    expect(await supplierOrdersRepo.deleteById('so-1', testDb)).toBe(true);
  });

  test('returns false when no row deleted', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    expect(await supplierOrdersRepo.deleteById('so-x', testDb)).toBe(false);
  });
});
