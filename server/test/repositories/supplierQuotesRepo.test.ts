import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as supplierQuotesRepo from '../../repositories/supplierQuotesRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// Builder fixtures match the column order in db/schema/supplierQuotes.ts:
//   [id, supplierId, supplierName, paymentTerms, status, expirationDate, notes, createdAt, updatedAt]
// `listAll` adds the linkedOrderId correlated subquery as a 10th projection column.
const QUOTE_BASE: readonly unknown[] = [
  'q-1',
  's-1',
  'Acme',
  'net30',
  'draft',
  '2026-06-01',
  null,
  new Date(1735689600000),
  new Date(1735689700000),
];

const quoteRow = (overrides: Record<number, unknown> = {}) => makeRow(QUOTE_BASE, overrides);

// listAll's projection appends linkedOrderId at position 9.
const QUOTE_LIST_BASE: readonly unknown[] = [...QUOTE_BASE, null];

const quoteListRow = (overrides: Record<number, unknown> = {}) =>
  makeRow(QUOTE_LIST_BASE, overrides);

const ITEM_BASE: readonly unknown[] = [
  'sqi-1',
  'q-1',
  null,
  'Widget',
  '2',
  '10.5',
  null,
  new Date(1735689600000),
  'unit',
];

const itemRow = (overrides: Record<number, unknown> = {}) => makeRow(ITEM_BASE, overrides);

describe('listAll', () => {
  test('issues a query with linkedOrderId correlated subquery', async () => {
    exec.enqueue({ rows: [quoteListRow({ 9: 'so-1' })] });
    const result = await supplierQuotesRepo.listAll(testDb);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('FROM supplier_sales');
    expect(sql).toContain('ss.linked_quote_id');
    expect(sql).toContain('order by "supplier_quotes"."created_at" desc');
    expect(result[0].linkedOrderId).toBe('so-1');
    expect(result[0].expirationDate).toBe('2026-06-01');
  });

  test('returns empty array when no rows', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.listAll(testDb)).toEqual([]);
  });
});

describe('listAllItems', () => {
  test('orders items by created_at ASC', async () => {
    exec.enqueue({ rows: [itemRow()] });
    const result = await supplierQuotesRepo.listAllItems(testDb);
    expect(exec.calls[0].sql).toContain('order by "supplier_quote_items"."created_at" asc');
    expect(result[0].quantity).toBe(2);
    expect(result[0].unitPrice).toBe(10.5);
    expect(result[0].unitType).toBe('unit');
  });

  test('coerces unitType null to "unit"', async () => {
    exec.enqueue({ rows: [itemRow({ 8: null })] });
    const result = await supplierQuotesRepo.listAllItems(testDb);
    expect(result[0].unitType).toBe('unit');
  });
});

describe('findLinkedOrderId', () => {
  test('returns id when found', async () => {
    exec.enqueue({ rows: [['so-1']] });
    expect(await supplierQuotesRepo.findLinkedOrderId('q-1', testDb)).toBe('so-1');
  });

  test('returns null when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.findLinkedOrderId('q-x', testDb)).toBeNull();
  });
});

describe('findIdConflict', () => {
  test('excludes self via <> predicate', async () => {
    exec.enqueue({ rows: [] });
    await supplierQuotesRepo.findIdConflict('new-id', 'cur-id', testDb);
    expect(exec.calls[0].sql).toContain('"id" <> $2');
    expect(exec.calls[0].params).toEqual(['new-id', 'cur-id']);
  });

  test('returns true when row matches', async () => {
    exec.enqueue({ rows: [['new-id']] });
    expect(await supplierQuotesRepo.findIdConflict('new-id', 'cur-id', testDb)).toBe(true);
  });
});

describe('update', () => {
  test('binds patch values via COALESCE, WHERE id last', async () => {
    exec.enqueue({ rows: [quoteRow()] });
    await supplierQuotesRepo.update('q-1', { status: 'sent', notes: 'hi' }, testDb);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('update "supplier_quotes"');
    expect(sql).toContain('COALESCE');
    expect(sql).toContain('CURRENT_TIMESTAMP');
    expect(sql).toContain('"id" = $8');
    expect(exec.calls[0].params).toHaveLength(8);
    expect(exec.calls[0].params[4]).toBe('sent'); // status
    expect(exec.calls[0].params[6]).toBe('hi'); // notes
    expect(exec.calls[0].params[7]).toBe('q-1'); // where id
  });

  test('returns null when no row updated', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.update('q-x', { status: 'sent' }, testDb)).toBeNull();
  });
});

describe('replaceItems', () => {
  test('issues DELETE then a single multi-row INSERT and preserves item order', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [itemRow({ 0: 'sqi-a' }), itemRow({ 0: 'sqi-b' })] });
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
    const result = await supplierQuotesRepo.replaceItems('q-1', items, testDb);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('delete from "supplier_quote_items"');
    expect(exec.calls[0].params).toEqual(['q-1']);
    expect(exec.calls[1].sql).toContain('insert into "supplier_quote_items"');
    expect(exec.calls[1].params[0]).toBe('sqi-a');
    expect(result.map((i) => i.id)).toEqual(['sqi-a', 'sqi-b']);
  });

  test('with empty items, deletes existing and skips INSERT', async () => {
    exec.enqueue({ rows: [] });
    const result = await supplierQuotesRepo.replaceItems('q-1', [], testDb);
    expect(exec.calls.length).toBe(1);
    expect(exec.calls[0].sql).toContain('delete from');
    expect(result).toEqual([]);
  });
});

describe('getQuoteItemSnapshots', () => {
  test('returns empty Map when given no ids without issuing a query', async () => {
    const result = await supplierQuotesRepo.getQuoteItemSnapshots([], testDb);
    expect(result.size).toBe(0);
    expect(exec.calls).toHaveLength(0);
  });

  test('deduplicates ids and filters falsy values', async () => {
    exec.enqueue({ rows: [] });
    await supplierQuotesRepo.getQuoteItemSnapshots(['', 'a', 'a', 'b'], testDb);
    // Drizzle inArray expands the array to individual params (a, b after dedup/filter).
    expect(exec.calls[0].params).toEqual(['a', 'b', 'accepted']);
  });

  test('joins on supplier_quotes filtered to status=accepted', async () => {
    exec.enqueue({ rows: [] });
    await supplierQuotesRepo.getQuoteItemSnapshots(['a'], testDb);
    expect(exec.calls[0].sql).toContain('"supplier_quotes"');
    expect(exec.calls[0].sql).toContain('inner join');
    // The status filter is parameterized; verify the param is present.
    expect(exec.calls[0].params).toContain('accepted');
  });

  test('maps row fields into snapshot shape with netCost mirroring unitPrice', async () => {
    exec.enqueue({ rows: [['sqi-1', 'sq-1', 'Acme', 'p-1', '12.5']] });
    const result = await supplierQuotesRepo.getQuoteItemSnapshots(['sqi-1'], testDb);
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
    exec.enqueue({ rows: [['Acme']] });
    expect(await supplierQuotesRepo.deleteById('q-1', testDb)).toEqual({ supplierName: 'Acme' });
  });

  test('returns null when no row deleted', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.deleteById('q-x', testDb)).toBeNull();
  });
});
