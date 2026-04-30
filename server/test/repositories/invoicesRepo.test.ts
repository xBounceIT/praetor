import { beforeEach, describe, expect, test } from 'bun:test';
import * as invoicesRepo from '../../repositories/invoicesRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

const rawInvoiceRow = {
  id: 'INV-2026-0001',
  linkedSaleId: null,
  clientId: 'c-1',
  clientName: 'Acme',
  issueDate: new Date('2026-04-01T00:00:00Z'),
  dueDate: new Date('2026-04-30T00:00:00Z'),
  status: 'draft',
  subtotal: '100',
  total: '110',
  amountPaid: '0',
  notes: null,
  createdAt: 1735689600000,
  updatedAt: 1735689700000,
};

const rawItemRow = {
  id: 'inv-item-1',
  invoiceId: 'INV-2026-0001',
  productId: null,
  description: 'Widget',
  unitOfMeasure: 'unit',
  quantity: '2',
  unitPrice: '50',
  discount: '0',
};

describe('generateNextId', () => {
  test('returns INV-{year}-0001 when no rows exist', async () => {
    exec.enqueue({ rows: [{ maxSequence: 0 }] });
    const id = await invoicesRepo.generateNextId('2026', exec);
    expect(id).toBe('INV-2026-0001');
    expect(exec.calls[0].params).toEqual(['^INV-2026-[0-9]+$']);
  });

  test('zero-pads to 4 digits and increments existing max', async () => {
    exec.enqueue({ rows: [{ maxSequence: '7' }] });
    const id = await invoicesRepo.generateNextId('2026', exec);
    expect(id).toBe('INV-2026-0008');
  });

  test('handles missing maxSequence row', async () => {
    exec.enqueue({ rows: [] });
    const id = await invoicesRepo.generateNextId('2026', exec);
    expect(id).toBe('INV-2026-0001');
  });
});

describe('listAll', () => {
  test('orders by created_at DESC and maps types', async () => {
    exec.enqueue({ rows: [rawInvoiceRow] });
    const result = await invoicesRepo.listAll(exec);
    expect(exec.calls[0].sql).toContain('ORDER BY created_at DESC');
    expect(result[0].issueDate).toBe('2026-04-01');
    expect(result[0].dueDate).toBe('2026-04-30');
    expect(result[0].subtotal).toBe(100);
    expect(result[0].total).toBe(110);
    expect(result[0].amountPaid).toBe(0);
  });
});

describe('listAllItems', () => {
  test('orders by created_at ASC and coerces unitOfMeasure', async () => {
    exec.enqueue({ rows: [rawItemRow, { ...rawItemRow, unitOfMeasure: 'hours' }] });
    const result = await invoicesRepo.listAllItems(exec);
    expect(exec.calls[0].sql).toContain('ORDER BY created_at ASC');
    expect(result[0].unitOfMeasure).toBe('unit');
    expect(result[1].unitOfMeasure).toBe('hours');
    expect(result[0].quantity).toBe(2);
    expect(result[0].unitPrice).toBe(50);
  });

  test('falls back to unit when unitOfMeasure is unknown', async () => {
    exec.enqueue({ rows: [{ ...rawItemRow, unitOfMeasure: null }] });
    const result = await invoicesRepo.listAllItems(exec);
    expect(result[0].unitOfMeasure).toBe('unit');
  });
});

describe('listAllWithItems', () => {
  test('groups items by invoiceId and preserves invoice order', async () => {
    exec.enqueue({
      rows: [
        { ...rawInvoiceRow, id: 'INV-1' },
        { ...rawInvoiceRow, id: 'INV-2' },
      ],
    });
    exec.enqueue({
      rows: [
        { ...rawItemRow, id: 'i-a', invoiceId: 'INV-2' },
        { ...rawItemRow, id: 'i-b', invoiceId: 'INV-1' },
        { ...rawItemRow, id: 'i-c', invoiceId: 'INV-1' },
      ],
    });
    const result = await invoicesRepo.listAllWithItems(exec);
    expect(result.map((i) => i.id)).toEqual(['INV-1', 'INV-2']);
    expect(result[0].items.map((i) => i.id)).toEqual(['i-b', 'i-c']);
    expect(result[1].items.map((i) => i.id)).toEqual(['i-a']);
  });

  test('returns empty items array when no items exist', async () => {
    exec.enqueue({ rows: [rawInvoiceRow] });
    exec.enqueue({ rows: [] });
    const result = await invoicesRepo.listAllWithItems(exec);
    expect(result[0].items).toEqual([]);
  });
});

describe('findDates', () => {
  test('returns normalized issueDate/dueDate when found', async () => {
    exec.enqueue({
      rows: [
        {
          issueDate: '2026-04-01T00:00:00Z',
          dueDate: new Date('2026-04-30T00:00:00Z'),
        },
      ],
    });
    const result = await invoicesRepo.findDates('INV-1', exec);
    expect(result).toEqual({ issueDate: '2026-04-01', dueDate: '2026-04-30' });
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await invoicesRepo.findDates('INV-X', exec)).toBeNull();
  });
});

describe('findIdConflict', () => {
  test('excludes self via id <> $2', async () => {
    exec.enqueue({ rows: [] });
    await invoicesRepo.findIdConflict('new-id', 'cur-id', exec);
    expect(exec.calls[0].sql).toContain('id <> $2');
    expect(exec.calls[0].params).toEqual(['new-id', 'cur-id']);
  });

  test('returns true when conflicting row exists', async () => {
    exec.enqueue({ rows: [{ id: 'new-id' }] });
    expect(await invoicesRepo.findIdConflict('new-id', 'cur-id', exec)).toBe(true);
  });
});

describe('create', () => {
  test('inserts all 11 fields and returns mapped invoice', async () => {
    exec.enqueue({ rows: [rawInvoiceRow] });
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
      exec,
    );
    expect(exec.calls[0].sql).toContain('INSERT INTO invoices');
    expect(exec.calls[0].params).toHaveLength(11);
    expect(result.id).toBe('INV-2026-0001');
    expect(result.subtotal).toBe(100);
  });
});

describe('update', () => {
  test('passes patch fields with null fallback for COALESCE preservation', async () => {
    exec.enqueue({ rows: [rawInvoiceRow] });
    await invoicesRepo.update('INV-2026-0001', { status: 'sent', total: 200 }, exec);
    expect(exec.calls[0].sql).toContain('UPDATE invoices SET');
    expect(exec.calls[0].sql).toContain('status = COALESCE($6, status)');
    expect(exec.calls[0].sql).toContain('updated_at = CURRENT_TIMESTAMP');
    const params = exec.calls[0].params;
    expect(params[5]).toBe('sent'); // status
    expect(params[7]).toBe(200); // total
    expect(params[0]).toBeNull(); // id (not in patch)
    expect(params[10]).toBe('INV-2026-0001'); // where clause
  });

  test('returns null when no row updated', async () => {
    exec.enqueue({ rows: [] });
    expect(await invoicesRepo.update('INV-X', { status: 'sent' }, exec)).toBeNull();
  });

  test('preserves notes=null as no-change via COALESCE', async () => {
    exec.enqueue({ rows: [rawInvoiceRow] });
    await invoicesRepo.update('INV-1', {}, exec);
    expect(exec.calls[0].params[9]).toBeNull();
  });
});

describe('replaceItems', () => {
  test('issues DELETE then a single multi-row INSERT and preserves order', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({
      rows: [
        { ...rawItemRow, id: 'a' },
        { ...rawItemRow, id: 'b' },
      ],
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
    const result = await invoicesRepo.replaceItems('INV-1', items, exec);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('DELETE FROM invoice_items');
    expect(exec.calls[0].params).toEqual(['INV-1']);
    expect(exec.calls[1].sql).toContain('INSERT INTO invoice_items');
    expect(exec.calls[1].sql).toContain('VALUES ($1, $2, $3, $4, $5, $6, $7, $8), ($9');
    expect(exec.calls[1].params[0]).toBe('a');
    expect(exec.calls[1].params[8]).toBe('b');
    expect(result.map((i) => i.id)).toEqual(['a', 'b']);
  });

  test('with empty items, deletes existing and skips INSERT', async () => {
    exec.enqueue({ rows: [] });
    const result = await invoicesRepo.replaceItems('INV-1', [], exec);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0].sql).toContain('DELETE');
    expect(result).toEqual([]);
  });
});

describe('deleteById', () => {
  test('returns id and clientName when deleted', async () => {
    exec.enqueue({ rows: [{ id: 'INV-1', clientName: 'Acme' }] });
    expect(await invoicesRepo.deleteById('INV-1', exec)).toEqual({
      id: 'INV-1',
      clientName: 'Acme',
    });
  });

  test('returns null when no row deleted', async () => {
    exec.enqueue({ rows: [] });
    expect(await invoicesRepo.deleteById('INV-X', exec)).toBeNull();
  });
});

describe('findItemsForInvoice', () => {
  test('filters by invoice_id and maps rows', async () => {
    exec.enqueue({ rows: [rawItemRow] });
    const result = await invoicesRepo.findItemsForInvoice('INV-1', exec);
    expect(exec.calls[0].sql).toContain('WHERE invoice_id = $1');
    expect(exec.calls[0].params).toEqual(['INV-1']);
    expect(result[0].id).toBe('inv-item-1');
  });
});
