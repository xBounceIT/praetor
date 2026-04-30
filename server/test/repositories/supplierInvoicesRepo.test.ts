import { beforeEach, describe, expect, test } from 'bun:test';
import * as supplierInvoicesRepo from '../../repositories/supplierInvoicesRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

const rawInvoiceRow = {
  id: 'SINV-2026-0001',
  linkedSaleId: 'so-1',
  supplierId: 's-1',
  supplierName: 'Acme',
  issueDate: new Date('2026-04-01T00:00:00Z'),
  dueDate: new Date('2026-04-30T00:00:00Z'),
  status: 'draft',
  subtotal: '100.50',
  total: '120.60',
  amountPaid: '0',
  notes: null,
  createdAt: 1735689600000,
  updatedAt: 1735689700000,
};

describe('listAll mapInvoice', () => {
  test('coerces numeric subtotal/total/amountPaid via Number()', async () => {
    exec.enqueue({ rows: [rawInvoiceRow] });
    const result = await supplierInvoicesRepo.listAll(exec);
    expect(result[0].subtotal).toBe(100.5);
    expect(result[0].total).toBe(120.6);
    expect(result[0].amountPaid).toBe(0);
  });

  test('defaults null numerics to 0', async () => {
    exec.enqueue({
      rows: [{ ...rawInvoiceRow, subtotal: null, total: null, amountPaid: null }],
    });
    const result = await supplierInvoicesRepo.listAll(exec);
    expect(result[0].subtotal).toBe(0);
    expect(result[0].total).toBe(0);
    expect(result[0].amountPaid).toBe(0);
  });

  test('normalizes Date issueDate/dueDate to YYYY-MM-DD strings', async () => {
    exec.enqueue({ rows: [rawInvoiceRow] });
    const result = await supplierInvoicesRepo.listAll(exec);
    expect(result[0].issueDate).toBe('2026-04-01');
    expect(result[0].dueDate).toBe('2026-04-30');
  });
});

describe('listAllItems', () => {
  test('coerces item numerics', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'sinv-item-1',
          invoiceId: 'SINV-2026-0001',
          productId: null,
          description: 'Widget',
          quantity: '2',
          unitPrice: '50',
          discount: null,
        },
      ],
    });
    const result = await supplierInvoicesRepo.listAllItems(exec);
    expect(result[0].quantity).toBe(2);
    expect(result[0].unitPrice).toBe(50);
    expect(result[0].discount).toBe(0);
  });
});

describe('findInvoiceForLinkedSale', () => {
  test('returns id when found', async () => {
    exec.enqueue({ rows: [{ id: 'SINV-2026-0001' }] });
    expect(await supplierInvoicesRepo.findInvoiceForLinkedSale('so-1', exec)).toBe(
      'SINV-2026-0001',
    );
  });

  test('returns null when no match', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierInvoicesRepo.findInvoiceForLinkedSale('so-x', exec)).toBeNull();
  });
});

describe('findExistingForUpdate', () => {
  test('returns id, status, issueDate, dueDate', async () => {
    exec.enqueue({
      rows: [
        {
          id: 'SINV-2026-0001',
          status: 'draft',
          issueDate: '2026-04-01',
          dueDate: '2026-04-30',
        },
      ],
    });
    expect(await supplierInvoicesRepo.findExistingForUpdate('SINV-2026-0001', exec)).toEqual({
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
    expect(await supplierInvoicesRepo.maxSequenceForYear('2026', exec)).toBe(42);
  });

  test('parses numeric maxSequence as-is', async () => {
    exec.enqueue({ rows: [{ maxSequence: 7 }] });
    expect(await supplierInvoicesRepo.maxSequenceForYear('2026', exec)).toBe(7);
  });

  test('uses regex parameter for the year', async () => {
    exec.enqueue({ rows: [{ maxSequence: 0 }] });
    await supplierInvoicesRepo.maxSequenceForYear('2026', exec);
    expect(exec.calls[0].params).toEqual(['^SINV-2026-[0-9]+$']);
  });

  test('returns 0 when no rows or null maxSequence', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierInvoicesRepo.maxSequenceForYear('2026', exec)).toBe(0);
  });
});

describe('create', () => {
  test('does NOT swallow unique-violation errors', async () => {
    exec.enqueue(() => {
      const err = new Error('duplicate key') as Error & { code?: string; constraint?: string };
      err.code = '23505';
      err.constraint = 'supplier_invoices_pkey';
      throw err;
    });
    await expect(
      supplierInvoicesRepo.create(
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
        exec,
      ),
    ).rejects.toThrow('duplicate key');
  });

  test('returns mapped invoice on success', async () => {
    exec.enqueue({ rows: [rawInvoiceRow] });
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
      exec,
    );
    expect(result.id).toBe('SINV-2026-0001');
    expect(result.subtotal).toBe(100.5);
    expect(result.issueDate).toBe('2026-04-01');
  });
});

describe('update', () => {
  test('falls back to SELECT on empty patch', async () => {
    exec.enqueue({ rows: [rawInvoiceRow] });
    await supplierInvoicesRepo.update('SINV-2026-0001', {}, exec);
    expect(exec.calls[0].sql.startsWith('SELECT')).toBe(true);
  });

  test('builds dynamic SET and bumps updated_at', async () => {
    exec.enqueue({ rows: [rawInvoiceRow] });
    await supplierInvoicesRepo.update('SINV-2026-0001', { status: 'paid', amountPaid: 100 }, exec);
    expect(exec.calls[0].sql).toContain('status = $1');
    expect(exec.calls[0].sql).toContain('amount_paid = $2');
    expect(exec.calls[0].sql).toContain('updated_at = CURRENT_TIMESTAMP');
    expect(exec.calls[0].params).toEqual(['paid', 100, 'SINV-2026-0001']);
  });
});

describe('replaceItems', () => {
  test('issues DELETE then a single multi-row INSERT', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({
      rows: [
        {
          id: 'sinv-item-a',
          invoiceId: 'SINV-2026-0001',
          productId: null,
          description: 'A',
          quantity: 1,
          unitPrice: 5,
          discount: 0,
        },
      ],
    });
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
      exec,
    );
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('DELETE FROM supplier_invoice_items');
    expect(exec.calls[1].sql).toContain('INSERT INTO supplier_invoice_items');
    expect(exec.calls[1].sql).toContain('VALUES ($1, $2, $3, $4, $5, $6, $7)');
  });

  test('with empty items, deletes existing and skips INSERT', async () => {
    exec.enqueue({ rows: [] });
    const result = await supplierInvoicesRepo.replaceItems('SINV-2026-0001', [], exec);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].sql).toContain('DELETE');
    expect(result).toEqual([]);
  });
});

describe('deleteById', () => {
  test('returns true when row deleted', async () => {
    exec.enqueue({ rows: [], rowCount: 1 });
    expect(await supplierInvoicesRepo.deleteById('SINV-2026-0001', exec)).toBe(true);
  });

  test('returns false when nothing deleted', async () => {
    exec.enqueue({ rows: [], rowCount: 0 });
    expect(await supplierInvoicesRepo.deleteById('SINV-2026-9999', exec)).toBe(false);
  });
});
