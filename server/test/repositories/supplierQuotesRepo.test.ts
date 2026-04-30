import { beforeEach, describe, expect, test } from 'bun:test';
import * as supplierQuotesRepo from '../../repositories/supplierQuotesRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

const rawQuoteRow = {
  id: 'q-1',
  supplierId: 's-1',
  supplierName: 'Acme',
  paymentTerms: 'net30',
  status: 'draft',
  expirationDate: new Date('2026-06-01T00:00:00Z'),
  notes: null,
  createdAt: 1735689600000,
  updatedAt: 1735689700000,
};

const rawItemRow = {
  id: 'sqi-1',
  quoteId: 'q-1',
  productId: null,
  productName: 'Widget',
  quantity: '2',
  unitPrice: '10.5',
  note: null,
  unitType: 'unit',
};

describe('listAll', () => {
  test('issues a query with linkedOrderId correlated subquery', async () => {
    exec.enqueue({ rows: [{ ...rawQuoteRow, linkedOrderId: 'so-1' }] });
    const result = await supplierQuotesRepo.listAll(exec);
    expect(exec.calls[0].sql).toContain('FROM supplier_sales ss');
    expect(exec.calls[0].sql).toContain('linked_quote_id = supplier_quotes.id');
    expect(exec.calls[0].sql).toContain('ORDER BY created_at DESC');
    expect(result[0].linkedOrderId).toBe('so-1');
    expect(result[0].expirationDate).toBe('2026-06-01');
  });

  test('returns empty array when no rows', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.listAll(exec)).toEqual([]);
  });
});

describe('listAllItems', () => {
  test('orders items by created_at ASC', async () => {
    exec.enqueue({ rows: [rawItemRow] });
    const result = await supplierQuotesRepo.listAllItems(exec);
    expect(exec.calls[0].sql).toContain('ORDER BY created_at ASC');
    expect(result[0].quantity).toBe(2);
    expect(result[0].unitPrice).toBe(10.5);
    expect(result[0].unitType).toBe('unit');
  });

  test('coerces unitType null to "unit"', async () => {
    exec.enqueue({ rows: [{ ...rawItemRow, unitType: null }] });
    const result = await supplierQuotesRepo.listAllItems(exec);
    expect(result[0].unitType).toBe('unit');
  });
});

describe('findLinkedOrderId', () => {
  test('returns id when found', async () => {
    exec.enqueue({ rows: [{ id: 'so-1' }] });
    expect(await supplierQuotesRepo.findLinkedOrderId('q-1', exec)).toBe('so-1');
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.findLinkedOrderId('q-x', exec)).toBeNull();
  });
});

describe('findIdConflict', () => {
  test('excludes self via id <> $2', async () => {
    exec.enqueue({ rows: [] });
    await supplierQuotesRepo.findIdConflict('new-id', 'cur-id', exec);
    expect(exec.calls[0].sql).toContain('id <> $2');
    expect(exec.calls[0].params).toEqual(['new-id', 'cur-id']);
  });

  test('returns true when row matches', async () => {
    exec.enqueue({ rows: [{ id: 'new-id' }] });
    expect(await supplierQuotesRepo.findIdConflict('new-id', 'cur-id', exec)).toBe(true);
  });
});

describe('update', () => {
  test('falls back to SELECT on empty patch', async () => {
    exec.enqueue({ rows: [rawQuoteRow] });
    await supplierQuotesRepo.update('q-1', {}, exec);
    expect(exec.calls[0].sql.startsWith('SELECT')).toBe(true);
  });

  test('writes only changed fields and bumps updated_at', async () => {
    exec.enqueue({ rows: [rawQuoteRow] });
    await supplierQuotesRepo.update('q-1', { status: 'sent', notes: 'hi' }, exec);
    expect(exec.calls[0].sql).toContain('status = $1');
    expect(exec.calls[0].sql).toContain('notes = $2');
    expect(exec.calls[0].sql).toContain('updated_at = CURRENT_TIMESTAMP');
    expect(exec.calls[0].params).toEqual(['sent', 'hi', 'q-1']);
  });
});

describe('replaceItems', () => {
  test('issues DELETE then a single multi-row INSERT and preserves item order', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({
      rows: [
        { ...rawItemRow, id: 'sqi-a' },
        { ...rawItemRow, id: 'sqi-b' },
      ],
    });
    const items = [
      {
        id: 'sqi-a',
        productId: null,
        productName: 'A',
        quantity: 1,
        unitPrice: 5,
        note: null,
        unitType: 'unit',
      },
      {
        id: 'sqi-b',
        productId: null,
        productName: 'B',
        quantity: 2,
        unitPrice: 6,
        note: null,
        unitType: 'unit',
      },
    ];
    const result = await supplierQuotesRepo.replaceItems('q-1', items, exec);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('DELETE FROM supplier_quote_items');
    expect(exec.calls[0].params).toEqual(['q-1']);
    expect(exec.calls[1].sql).toContain('INSERT INTO supplier_quote_items');
    expect(exec.calls[1].sql).toContain('VALUES ($1, $2, $3, $4, $5, $6, $7, $8), ($9');
    expect(exec.calls[1].params[0]).toBe('sqi-a');
    expect(exec.calls[1].params[8]).toBe('sqi-b');
    expect(result.map((i) => i.id)).toEqual(['sqi-a', 'sqi-b']);
  });

  test('with empty items, deletes existing and skips INSERT', async () => {
    exec.enqueue({ rows: [] });
    const result = await supplierQuotesRepo.replaceItems('q-1', [], exec);
    expect(exec.calls.length).toBe(1);
    expect(exec.calls[0].sql).toContain('DELETE');
    expect(result).toEqual([]);
  });
});

describe('getQuoteItemSnapshots', () => {
  test('returns empty Map when given no ids without issuing a query', async () => {
    const result = await supplierQuotesRepo.getQuoteItemSnapshots([], exec);
    expect(result.size).toBe(0);
    expect(exec.calls).toHaveLength(0);
  });

  test('deduplicates ids and filters falsy values', async () => {
    exec.enqueue({ rows: [] });
    await supplierQuotesRepo.getQuoteItemSnapshots(['', 'a', 'a', 'b'], exec);
    expect(exec.calls[0].params).toEqual([['a', 'b']]);
  });

  test('joins on supplier_quotes filtered to status=accepted', async () => {
    exec.enqueue({ rows: [] });
    await supplierQuotesRepo.getQuoteItemSnapshots(['a'], exec);
    expect(exec.calls[0].sql).toContain('JOIN supplier_quotes sq ON sq.id = sqi.quote_id');
    expect(exec.calls[0].sql).toContain("sq.status = 'accepted'");
  });

  test('maps row fields into snapshot shape with netCost mirroring unitPrice', async () => {
    exec.enqueue({
      rows: [
        {
          itemId: 'sqi-1',
          quoteId: 'sq-1',
          supplierName: 'Acme',
          productId: 'p-1',
          unitPrice: '12.5',
        },
      ],
    });
    const result = await supplierQuotesRepo.getQuoteItemSnapshots(['sqi-1'], exec);
    expect(result.get('sqi-1')).toEqual({
      supplierQuoteId: 'sq-1',
      supplierName: 'Acme',
      productId: 'p-1',
      unitPrice: 12.5,
      netCost: 12.5,
    });
  });
});

describe('deleteById', () => {
  test('returns supplierName when row deleted', async () => {
    exec.enqueue({ rows: [{ supplier_name: 'Acme' }] });
    expect(await supplierQuotesRepo.deleteById('q-1', exec)).toEqual({ supplierName: 'Acme' });
  });

  test('returns null when no row deleted', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.deleteById('q-x', exec)).toBeNull();
  });
});
