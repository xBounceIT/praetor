import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as invoicesRepo from '../../repositories/invoicesRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// `invoices` columns in schema declaration order:
// id, linked_sale_id, client_id, client_name, issue_date, due_date, status, subtotal, total,
// amount_paid, notes, created_at, updated_at
const INVOICE_BASE: readonly unknown[] = [
  'INV-2026-0001',
  null,
  'c-1',
  'Acme',
  '2026-04-01',
  '2026-04-30',
  'draft',
  '100',
  '110',
  '0',
  null,
  new Date('2026-04-01T00:00:00Z'),
  new Date('2026-04-01T00:01:00Z'),
];
const invoiceRow = (overrides: Record<number, unknown> = {}) => makeRow(INVOICE_BASE, overrides);

// `invoice_items` columns:
// id, invoice_id, product_id, description, unit_of_measure, quantity, unit_price, discount,
// created_at
const ITEM_BASE: readonly unknown[] = [
  'inv-item-1',
  'INV-2026-0001',
  null,
  'Widget',
  'unit',
  '2',
  '50',
  '0',
  new Date('2026-04-01T00:00:00Z'),
];
const itemRow = (overrides: Record<number, unknown> = {}) => makeRow(ITEM_BASE, overrides);

describe('generateNextId', () => {
  test('returns INV-{year}-0001 when no rows exist', async () => {
    exec.enqueue({ rows: [{ maxSequence: 0 }] });
    const id = await invoicesRepo.generateNextId('2026', testDb);
    expect(id).toBe('INV-2026-0001');
    expect(exec.calls[0].params).toContain('^INV-2026-[0-9]+$');
  });

  test('zero-pads to 4 digits and increments existing max', async () => {
    exec.enqueue({ rows: [{ maxSequence: '7' }] });
    const id = await invoicesRepo.generateNextId('2026', testDb);
    expect(id).toBe('INV-2026-0008');
  });

  test('handles missing maxSequence row', async () => {
    exec.enqueue({ rows: [] });
    const id = await invoicesRepo.generateNextId('2026', testDb);
    expect(id).toBe('INV-2026-0001');
  });
});

describe('listAll', () => {
  test('orders by created_at DESC and maps numerics', async () => {
    exec.enqueue({ rows: [invoiceRow()] });
    const result = await invoicesRepo.listAll(testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('order by "invoices"."created_at" desc');
    expect(result[0].issueDate).toBe('2026-04-01');
    expect(result[0].dueDate).toBe('2026-04-30');
    expect(result[0].subtotal).toBe(100);
    expect(result[0].total).toBe(110);
    expect(result[0].amountPaid).toBe(0);
  });
});

describe('listAllItems', () => {
  test('orders by created_at and coerces unitOfMeasure', async () => {
    exec.enqueue({ rows: [itemRow(), itemRow({ 0: 'inv-item-2', 4: 'hours' })] });
    const result = await invoicesRepo.listAllItems(testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('order by "invoice_items"."created_at"');
    expect(result[0].unitOfMeasure).toBe('unit');
    expect(result[1].unitOfMeasure).toBe('hours');
    expect(result[0].quantity).toBe(2);
    expect(result[0].unitPrice).toBe(50);
  });

  test('falls back to unit when unitOfMeasure is unknown', async () => {
    exec.enqueue({ rows: [itemRow({ 4: 'gallons' })] });
    const result = await invoicesRepo.listAllItems(testDb);
    expect(result[0].unitOfMeasure).toBe('unit');
  });
});

describe('listAllWithItems', () => {
  test('groups items by invoiceId and preserves invoice order', async () => {
    exec.enqueue({
      rows: [invoiceRow({ 0: 'INV-1' }), invoiceRow({ 0: 'INV-2' })],
    });
    exec.enqueue({
      rows: [
        itemRow({ 0: 'i-a', 1: 'INV-2' }),
        itemRow({ 0: 'i-b', 1: 'INV-1' }),
        itemRow({ 0: 'i-c', 1: 'INV-1' }),
      ],
    });
    const result = await invoicesRepo.listAllWithItems(testDb);
    expect(result.map((i) => i.id)).toEqual(['INV-1', 'INV-2']);
    expect(result[0].items.map((i) => i.id)).toEqual(['i-b', 'i-c']);
    expect(result[1].items.map((i) => i.id)).toEqual(['i-a']);
  });

  test('returns empty items array when no items exist', async () => {
    exec.enqueue({ rows: [invoiceRow()] });
    exec.enqueue({ rows: [] });
    const result = await invoicesRepo.listAllWithItems(testDb);
    expect(result[0].items).toEqual([]);
  });
});

describe('findDates', () => {
  test('returns normalized issueDate/dueDate when found', async () => {
    exec.enqueue({ rows: [['2026-04-01T00:00:00Z', new Date('2026-04-30T00:00:00Z')]] });
    const result = await invoicesRepo.findDates('INV-1', testDb);
    expect(result).toEqual({ issueDate: '2026-04-01', dueDate: '2026-04-30' });
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await invoicesRepo.findDates('INV-X', testDb)).toBeNull();
  });

  test('throws if a column comes back null (schema invariant: NOT NULL)', async () => {
    exec.enqueue({ rows: [['2026-04-01', null]] });
    await expect(invoicesRepo.findDates('INV-1', testDb)).rejects.toThrow(/dueDate/);
  });
});

describe('findIdConflict', () => {
  test('excludes self with both id-equality and id-inequality predicates', async () => {
    exec.enqueue({ rows: [] });
    await invoicesRepo.findIdConflict('new-id', 'cur-id', testDb);
    expect(exec.calls[0].params).toContain('new-id');
    expect(exec.calls[0].params).toContain('cur-id');
  });

  test('returns true when conflicting row exists', async () => {
    exec.enqueue({ rows: [['new-id']] });
    expect(await invoicesRepo.findIdConflict('new-id', 'cur-id', testDb)).toBe(true);
  });
});

describe('create', () => {
  test('inserts and returns mapped invoice', async () => {
    exec.enqueue({ rows: [invoiceRow()] });
    const result = await invoicesRepo.create(
      {
        id: 'INV-2026-0001',
        linkedSaleId: null,
        clientId: 'c-1',
        clientName: 'Acme',
        issueDate: '2026-04-01',
        dueDate: '2026-04-30',
        status: 'draft',
        subtotal: 100,
        total: 110,
        amountPaid: 0,
        notes: null,
      },
      testDb,
    );
    expect(exec.calls[0].sql.toLowerCase()).toContain('insert into "invoices"');
    expect(result.id).toBe('INV-2026-0001');
    expect(result.subtotal).toBe(100);
  });
});

describe('update', () => {
  test('uses COALESCE-per-column, sets updated_at, and includes id in WHERE', async () => {
    exec.enqueue({ rows: [invoiceRow()] });
    await invoicesRepo.update('INV-2026-0001', { status: 'sent', total: 200 }, testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('update "invoices"');
    expect(sql).toContain('coalesce');
    expect(sql).toContain('current_timestamp');
    expect(exec.calls[0].params).toContain('sent');
    expect(exec.calls[0].params).toContain('200');
    expect(exec.calls[0].params).toContain('INV-2026-0001');
  });

  test('returns null when no row updated', async () => {
    exec.enqueue({ rows: [] });
    expect(await invoicesRepo.update('INV-X', { status: 'sent' }, testDb)).toBeNull();
  });

  test('empty patch still emits an UPDATE (every column COALESCEs to its own value)', async () => {
    exec.enqueue({ rows: [invoiceRow()] });
    await invoicesRepo.update('INV-1', {}, testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('update');
    expect(exec.calls[0].params).toContain('INV-1');
  });
});

describe('replaceItems', () => {
  test('issues DELETE then a single multi-row INSERT and preserves order', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({
      rows: [itemRow({ 0: 'a' }), itemRow({ 0: 'b' })],
    });
    const items = [
      {
        id: 'a',
        productId: null,
        description: 'A',
        unitOfMeasure: 'unit' as const,
        quantity: 1,
        unitPrice: 5,
        discount: 0,
      },
      {
        id: 'b',
        productId: null,
        description: 'B',
        unitOfMeasure: 'hours' as const,
        quantity: 2,
        unitPrice: 6,
        discount: 1,
      },
    ];
    const result = await invoicesRepo.replaceItems('INV-1', items, testDb);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql.toLowerCase()).toContain('delete from "invoice_items"');
    expect(exec.calls[0].params).toContain('INV-1');
    expect(exec.calls[1].sql.toLowerCase()).toContain('insert into "invoice_items"');
    // Both ids appear in the INSERT params (Drizzle's array-values form).
    expect(exec.calls[1].params).toContain('a');
    expect(exec.calls[1].params).toContain('b');
    expect(result.map((i) => i.id)).toEqual(['a', 'b']);
  });

  test('with empty items, deletes existing and skips INSERT', async () => {
    exec.enqueue({ rows: [] });
    const result = await invoicesRepo.replaceItems('INV-1', [], testDb);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].sql.toLowerCase()).toContain('delete');
    expect(result).toEqual([]);
  });
});

describe('deleteById', () => {
  test('returns id and clientName when deleted', async () => {
    exec.enqueue({ rows: [['INV-1', 'Acme']] });
    expect(await invoicesRepo.deleteById('INV-1', testDb)).toEqual({
      id: 'INV-1',
      clientName: 'Acme',
    });
  });

  test('returns null when no row deleted', async () => {
    exec.enqueue({ rows: [] });
    expect(await invoicesRepo.deleteById('INV-X', testDb)).toBeNull();
  });
});

describe('findItemsForInvoice', () => {
  test('filters by invoice_id and maps rows', async () => {
    exec.enqueue({ rows: [itemRow()] });
    const result = await invoicesRepo.findItemsForInvoice('INV-1', testDb);
    expect(exec.calls[0].params).toContain('INV-1');
    expect(result[0].id).toBe('inv-item-1');
  });
});
