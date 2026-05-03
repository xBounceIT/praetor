import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as supplierInvoicesRepo from '../../repositories/supplierInvoicesRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// Builder fixtures match the column order in db/schema/supplierInvoices.ts. Drizzle's date
// columns in `mode: 'string'` return YYYY-MM-DD strings; numerics return as strings;
// timestamps return as Date instances.
const INVOICE_BASE: readonly unknown[] = [
  'SINV-2026-0001',
  'so-1',
  's-1',
  'Acme',
  '2026-04-01',
  '2026-04-30',
  'draft',
  '100.50',
  '120.60',
  '0',
  null,
  new Date(1735689600000),
  new Date(1735689700000),
];

const invoiceRow = (overrides: Record<number, unknown> = {}) => makeRow(INVOICE_BASE, overrides);

const ITEM_BASE: readonly unknown[] = [
  'sinv-item-1',
  'SINV-2026-0001',
  null,
  'Widget',
  '2',
  '50',
  null,
  new Date(1735689600000),
];

const itemRow = (overrides: Record<number, unknown> = {}) => makeRow(ITEM_BASE, overrides);

describe('listAll mapInvoice', () => {
  test('coerces numeric subtotal/total/amountPaid', async () => {
    exec.enqueue({ rows: [invoiceRow()] });
    const result = await supplierInvoicesRepo.listAll(testDb);
    expect(result[0].subtotal).toBe(100.5);
    expect(result[0].total).toBe(120.6);
    expect(result[0].amountPaid).toBe(0);
  });

  test('defaults null numerics to 0', async () => {
    exec.enqueue({ rows: [invoiceRow({ 7: null, 8: null, 9: null })] });
    const result = await supplierInvoicesRepo.listAll(testDb);
    expect(result[0].subtotal).toBe(0);
    expect(result[0].total).toBe(0);
    expect(result[0].amountPaid).toBe(0);
  });

  test('passes issueDate/dueDate through as YYYY-MM-DD strings', async () => {
    exec.enqueue({ rows: [invoiceRow()] });
    const result = await supplierInvoicesRepo.listAll(testDb);
    expect(result[0].issueDate).toBe('2026-04-01');
    expect(result[0].dueDate).toBe('2026-04-30');
  });
});

describe('listAllItems', () => {
  test('coerces item numerics', async () => {
    exec.enqueue({ rows: [itemRow()] });
    const result = await supplierInvoicesRepo.listAllItems(testDb);
    expect(result[0].quantity).toBe(2);
    expect(result[0].unitPrice).toBe(50);
    expect(result[0].discount).toBe(0);
  });
});

describe('findInvoiceForLinkedSale', () => {
  test('returns id when found', async () => {
    exec.enqueue({ rows: [['SINV-2026-0001']] });
    expect(await supplierInvoicesRepo.findInvoiceForLinkedSale('so-1', testDb)).toBe(
      'SINV-2026-0001',
    );
  });

  test('returns null when no match', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierInvoicesRepo.findInvoiceForLinkedSale('so-x', testDb)).toBeNull();
  });
});

describe('findExistingForUpdate', () => {
  test('returns id, status, issueDate, dueDate', async () => {
    exec.enqueue({ rows: [['SINV-2026-0001', 'draft', '2026-04-01', '2026-04-30']] });
    expect(await supplierInvoicesRepo.findExistingForUpdate('SINV-2026-0001', testDb)).toEqual({
      id: 'SINV-2026-0001',
      status: 'draft',
      issueDate: '2026-04-01',
      dueDate: '2026-04-30',
    });
  });
});

describe('maxSequenceForYear', () => {
  test('parses string maxSequence to Number', async () => {
    exec.enqueue({ rows: [{ maxSequence: '42' }] });
    expect(await supplierInvoicesRepo.maxSequenceForYear('2026', testDb)).toBe(42);
  });

  test('parses numeric maxSequence as-is', async () => {
    exec.enqueue({ rows: [{ maxSequence: 7 }] });
    expect(await supplierInvoicesRepo.maxSequenceForYear('2026', testDb)).toBe(7);
  });

  test('uses regex parameter for the year', async () => {
    exec.enqueue({ rows: [{ maxSequence: 0 }] });
    await supplierInvoicesRepo.maxSequenceForYear('2026', testDb);
    expect(exec.calls[0].params).toContain('^SINV-2026-[0-9]+$');
  });

  test('returns 0 when no rows or null maxSequence', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierInvoicesRepo.maxSequenceForYear('2026', testDb)).toBe(0);
  });
});

describe('create', () => {
  test('does NOT swallow unique-violation errors (propagates with cause preserved)', async () => {
    // Drizzle wraps thrown driver errors in DrizzleQueryError("Failed query: ...") with the
    // original error available via `.cause`. The repo doesn't catch — verify propagation by
    // unwrapping the cause and inspecting the original code/constraint.
    exec.enqueue(() => {
      const err = new Error('duplicate key') as Error & { code?: string; constraint?: string };
      err.code = '23505';
      err.constraint = 'supplier_invoices_pkey';
      throw err;
    });
    let thrown: unknown;
    try {
      await supplierInvoicesRepo.create(
        {
          id: 'SINV-2026-0001',
          linkedSaleId: null,
          supplierId: 's-1',
          supplierName: 'Acme',
          issueDate: '2026-04-01',
          dueDate: '2026-04-30',
          status: 'draft',
          subtotal: 0,
          total: 0,
          amountPaid: 0,
          notes: null,
        },
        testDb,
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    const inner = (thrown as { cause?: Error & { code?: string } }).cause;
    expect(inner?.code).toBe('23505');
    expect(inner?.message).toContain('duplicate key');
  });

  test('returns mapped invoice on success', async () => {
    exec.enqueue({ rows: [invoiceRow()] });
    const result = await supplierInvoicesRepo.create(
      {
        id: 'SINV-2026-0001',
        linkedSaleId: 'so-1',
        supplierId: 's-1',
        supplierName: 'Acme',
        issueDate: '2026-04-01',
        dueDate: '2026-04-30',
        status: 'draft',
        subtotal: 100.5,
        total: 120.6,
        amountPaid: 0,
        notes: null,
      },
      testDb,
    );
    expect(result.id).toBe('SINV-2026-0001');
    expect(result.subtotal).toBe(100.5);
    expect(result.issueDate).toBe('2026-04-01');
  });
});

describe('update', () => {
  test('binds patch values via COALESCE, WHERE id last', async () => {
    exec.enqueue({ rows: [invoiceRow()] });
    await supplierInvoicesRepo.update(
      'SINV-2026-0001',
      { status: 'paid', amountPaid: 100 },
      testDb,
    );
    const sql = exec.calls[0].sql;
    expect(sql).toContain('update "supplier_invoices"');
    expect(sql).toContain('COALESCE');
    expect(sql).toContain('CURRENT_TIMESTAMP');
    expect(sql).toContain('"id" = $11');
    expect(exec.calls[0].params).toHaveLength(11);
    expect(exec.calls[0].params[5]).toBe('paid'); // status
    expect(exec.calls[0].params[8]).toBe('100'); // amountPaid via numericForDb
    expect(exec.calls[0].params[10]).toBe('SINV-2026-0001'); // where id
  });

  test('returns null when no row updated', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierInvoicesRepo.update('SINV-X', { status: 'paid' }, testDb)).toBeNull();
  });

  test('empty patch falls back to SELECT (no UPDATE issued, updated_at preserved)', async () => {
    exec.enqueue({ rows: [invoiceRow()] });
    const result = await supplierInvoicesRepo.update('SINV-2026-0001', {}, testDb);
    const sqlText = exec.calls[0].sql.toLowerCase();
    expect(sqlText).not.toContain('update "supplier_invoices"');
    expect(sqlText).toContain('select');
    expect(result?.id).toBe('SINV-2026-0001');
  });

  test('patch with only undefined values also falls back to SELECT', async () => {
    exec.enqueue({ rows: [invoiceRow()] });
    await supplierInvoicesRepo.update(
      'SINV-2026-0001',
      { status: undefined, notes: undefined },
      testDb,
    );
    expect(exec.calls[0].sql.toLowerCase()).not.toContain('update "supplier_invoices"');
  });
});

describe('replaceItems', () => {
  test('issues DELETE then a single multi-row INSERT', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [itemRow({ 0: 'sinv-item-a', 3: 'A', 4: '1', 5: '5' })] });
    await supplierInvoicesRepo.replaceItems(
      'SINV-2026-0001',
      [
        {
          id: 'sinv-item-a',
          productId: null,
          description: 'A',
          quantity: 1,
          unitPrice: 5,
          discount: 0,
        },
      ],
      testDb,
    );
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('delete from "supplier_invoice_items"');
    expect(exec.calls[1].sql).toContain('insert into "supplier_invoice_items"');
  });

  test('with empty items, deletes existing and skips INSERT', async () => {
    exec.enqueue({ rows: [] });
    const result = await supplierInvoicesRepo.replaceItems('SINV-2026-0001', [], testDb);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].sql).toContain('delete from');
    expect(result).toEqual([]);
  });
});

describe('deleteById', () => {
  test('returns true when row deleted', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    expect(await supplierInvoicesRepo.deleteById('SINV-2026-0001', testDb)).toBe(true);
  });

  test('returns false when nothing deleted', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    expect(await supplierInvoicesRepo.deleteById('SINV-2026-9999', testDb)).toBe(false);
  });
});
