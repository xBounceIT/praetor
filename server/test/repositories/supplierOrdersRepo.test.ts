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

// Column order in db/schema/supplierSales.ts (supplier_sale_items):
//   [id, saleId, productId, productName, quantity, unitPrice, discount, note, createdAt,
//    durationMonths, durationUnit]
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
  1,
  'months',
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

describe('findExisting', () => {
  test('returns mapped object with linkedQuoteId', async () => {
    exec.enqueue({ rows: [['so-1', 'q-1', 's-1', 'Acme', 'draft']] });
    expect(await supplierOrdersRepo.findExisting('so-1', testDb)).toEqual({
      id: 'so-1',
      linkedQuoteId: 'q-1',
      supplierId: 's-1',
      supplierName: 'Acme',
      status: 'draft',
    });
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierOrdersRepo.findExisting('so-x', testDb)).toBeNull();
  });
});

describe('lockExistingById', () => {
  test('uses FOR UPDATE in the emitted SQL', async () => {
    exec.enqueue({ rows: [['so-1', 'q-1', 's-1', 'Acme', 'draft']] });
    await supplierOrdersRepo.lockExistingById('so-1', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('for update');
    expect(exec.calls[0].params).toContain('so-1');
  });

  test('returns mapped row when present', async () => {
    exec.enqueue({ rows: [['so-1', 'q-1', 's-1', 'Acme', 'sent']] });
    const result = await supplierOrdersRepo.lockExistingById('so-1', testDb);
    expect(result?.id).toBe('so-1');
    expect(result?.status).toBe('sent');
  });

  test('returns null when row missing', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierOrdersRepo.lockExistingById('so-x', testDb)).toBeNull();
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
  test('binds patch values via COALESCE, WHERE id last - no id in SET (issue #621)', async () => {
    exec.enqueue({ rows: [orderRow()] });
    await supplierOrdersRepo.update('so-1', { status: 'sent', discount: 10 }, testDb);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('update "supplier_sales"');
    expect(sql).toContain('COALESCE');
    expect(sql).toContain('CURRENT_TIMESTAMP');
    // The SET clause must NOT touch the primary key column.
    expect(sql).not.toMatch(/set[^"]*"id"\s*=/i);
    expect(sql).toContain('"id" = $8');
    expect(exec.calls[0].params).toHaveLength(8);
    expect(exec.calls[0].params[3]).toBe('10'); // discount via numericForDb
    expect(exec.calls[0].params[5]).toBe('sent'); // status
    expect(exec.calls[0].params[7]).toBe('so-1'); // where id
  });

  test('returns null when no row updated', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierOrdersRepo.update('so-x', { status: 'sent' }, testDb)).toBeNull();
  });

  test('empty patch falls back to SELECT (no UPDATE issued, updated_at preserved)', async () => {
    exec.enqueue({ rows: [orderRow()] });
    const result = await supplierOrdersRepo.update('so-1', {}, testDb);
    const sqlText = exec.calls[0].sql.toLowerCase();
    expect(sqlText).not.toContain('update "supplier_sales"');
    expect(sqlText).toContain('select');
    expect(result?.id).toBe('so-1');
  });
});

describe('rename', () => {
  test('issues a dedicated UPDATE that sets the id column and returns the mapped order', async () => {
    exec.enqueue({ rows: [orderRow({ 0: 'so-2' })] });
    const result = await supplierOrdersRepo.rename('so-1', 'so-2', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('update "supplier_sales"');
    expect(sql).toMatch(/set[^"]*"id"\s*=/);
    expect(sql).toContain('current_timestamp');
    expect(exec.calls[0].params).toContain('so-2'); // new id
    expect(exec.calls[0].params).toContain('so-1'); // where current id
    expect(result?.id).toBe('so-2');
  });

  test('returns null when no row matched currentId', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierOrdersRepo.rename('so-x', 'so-y', testDb)).toBeNull();
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
          durationMonths: 9,
          durationUnit: 'years' as const,
        },
      ],
      testDb,
    );
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('delete from "supplier_sale_items"');
    expect(exec.calls[1].sql).toContain('insert into "supplier_sale_items"');
    // Duration is written to the INSERT (issue #776).
    expect(exec.calls[1].params).toContain(9);
    expect(exec.calls[1].params).toContain('years');
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

describe('listAllItems', () => {
  test('orders items by created_at ASC and maps fields', async () => {
    exec.enqueue({ rows: [itemRow()] });
    const result = await supplierOrdersRepo.listAllItems(testDb);
    expect(exec.calls[0].sql).toContain('order by "supplier_sale_items"."created_at" asc');
    expect(result[0].id).toBe('ssi-1');
    expect(result[0].orderId).toBe('so-1');
    expect(result[0].quantity).toBe(1);
  });

  test('maps the duration columns (issue #776)', async () => {
    exec.enqueue({ rows: [itemRow({ 9: 18, 10: 'years' })] });
    const result = await supplierOrdersRepo.listAllItems(testDb);
    expect(result[0].durationMonths).toBe(18);
    expect(result[0].durationUnit).toBe('years');
  });

  test('defaults a null/legacy duration to one month (issue #776)', async () => {
    exec.enqueue({ rows: [itemRow({ 9: null, 10: null })] });
    const result = await supplierOrdersRepo.listAllItems(testDb);
    expect(result[0].durationMonths).toBe(1);
    expect(result[0].durationUnit).toBe('months');
  });
});

describe('existsById', () => {
  test('returns true when row exists', async () => {
    exec.enqueue({ rows: [['so-1']] });
    expect(await supplierOrdersRepo.existsById('so-1', testDb)).toBe(true);
  });

  test('returns false when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierOrdersRepo.existsById('so-x', testDb)).toBe(false);
  });
});

describe('findItemsForOrder', () => {
  test('selects items filtered by orderId and maps them', async () => {
    exec.enqueue({ rows: [itemRow()] });
    const result = await supplierOrdersRepo.findItemsForOrder('so-1', testDb);
    expect(exec.calls[0].sql).toContain('from "supplier_sale_items"');
    expect(exec.calls[0].params).toContain('so-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ssi-1');
  });

  test('orders rows deterministically by created_at then id', async () => {
    exec.enqueue({ rows: [] });
    await supplierOrdersRepo.findItemsForOrder('so-1', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('order by');
    expect(sql).toMatch(/"created_at".*,.*"id"/);
  });
});

describe('findFullForSnapshot', () => {
  test('returns order and items when order exists', async () => {
    exec.enqueue({ rows: [orderRow()] });
    exec.enqueue({ rows: [itemRow()] });
    const result = await supplierOrdersRepo.findFullForSnapshot('so-1', testDb);
    expect(result).not.toBeNull();
    expect(result?.order.id).toBe('so-1');
    expect(result?.items).toHaveLength(1);
  });

  test('returns null when order not found', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    expect(await supplierOrdersRepo.findFullForSnapshot('so-x', testDb)).toBeNull();
  });
});

describe('findExistingByLinkedQuote', () => {
  test('returns id when found', async () => {
    exec.enqueue({ rows: [['so-1']] });
    expect(await supplierOrdersRepo.findExistingByLinkedQuote('q-1', testDb)).toBe('so-1');
    expect(exec.calls[0].params).toContain('q-1');
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierOrdersRepo.findExistingByLinkedQuote('q-x', testDb)).toBeNull();
  });
});

describe('create', () => {
  test('inserts and returns mapped order', async () => {
    exec.enqueue({ rows: [orderRow()] });
    const result = await supplierOrdersRepo.create(
      {
        id: 'so-1',
        linkedQuoteId: 'q-1',
        supplierId: 's-1',
        supplierName: 'Acme',
        paymentTerms: 'net30',
        discount: 5,
        discountType: 'percentage',
        status: 'draft',
        notes: null,
      },
      testDb,
    );
    expect(exec.calls[0].sql).toContain('insert into "supplier_sales"');
    expect(exec.calls[0].params).toContain('so-1');
    expect(exec.calls[0].params).toContain('q-1');
    expect(exec.calls[0].params).toContain('Acme');
    expect(result.id).toBe('so-1');
  });
});

describe('restoreSnapshotOrder', () => {
  test('updates with snapshot fields and returns mapped order', async () => {
    exec.enqueue({ rows: [orderRow()] });
    const result = await supplierOrdersRepo.restoreSnapshotOrder(
      'so-1',
      {
        supplierId: 's-1',
        supplierName: 'Acme',
        paymentTerms: 'net30',
        discount: 5,
        discountType: 'percentage',
        status: 'draft',
        notes: 'restored',
      },
      testDb,
    );
    expect(exec.calls[0].sql).toContain('update "supplier_sales"');
    expect(exec.calls[0].sql).toContain('CURRENT_TIMESTAMP');
    expect(exec.calls[0].params).toContain('Acme');
    expect(exec.calls[0].params).toContain('so-1');
    expect(result?.id).toBe('so-1');
  });

  test('falls back to "immediate" paymentTerms when snapshot.paymentTerms is null', async () => {
    exec.enqueue({ rows: [orderRow()] });
    await supplierOrdersRepo.restoreSnapshotOrder(
      'so-1',
      {
        supplierId: 's-1',
        supplierName: 'Acme',
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
    const result = await supplierOrdersRepo.restoreSnapshotOrder(
      'so-x',
      {
        supplierId: 's-1',
        supplierName: 'Acme',
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
});
