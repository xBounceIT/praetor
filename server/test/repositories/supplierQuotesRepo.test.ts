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
//   [id, supplierId, supplierName, clientId, clientName, paymentTerms, status,
//    expirationDate, communicationChannelId, notes, createdAt, updatedAt, communicationChannelName]
// `listAll` adds the linkedOrderId correlated subquery after communicationChannelName.
const QUOTE_BASE: readonly unknown[] = [
  'q-1',
  's-1',
  'Acme',
  null,
  null,
  'net30',
  'draft',
  '2026-06-01',
  'qcc_email',
  null,
  new Date(1735689600000),
  new Date(1735689700000),
  'Email',
];

const quoteRow = (overrides: Record<number, unknown> = {}) => makeRow(QUOTE_BASE, overrides);

// listAll's projection appends linkedOrderId at position 13.
const QUOTE_LIST_BASE: readonly unknown[] = [...QUOTE_BASE, null];

const quoteListRow = (overrides: Record<number, unknown> = {}) =>
  makeRow(QUOTE_LIST_BASE, overrides);

// Column order in db/schema/supplierQuotes.ts (supplier_quote_items):
//   [id, quoteId, productId, productName, quantity, unitPrice, note, createdAt, unitType,
//    listPrice, discountPercent, durationMonths, durationUnit]
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
  '21',
  '50',
  1,
  'months',
];

const itemRow = (overrides: Record<number, unknown> = {}) => makeRow(ITEM_BASE, overrides);

describe('listAll', () => {
  test('issues a query with linkedOrderId correlated subquery', async () => {
    exec.enqueue({ rows: [quoteListRow({ 13: 'so-1' })] });
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
    expect(result[0].listPrice).toBe(21);
    expect(result[0].discountPercent).toBe(50);
    expect(result[0].unitType).toBe('unit');
  });

  test('coerces unitType null to "unit"', async () => {
    exec.enqueue({ rows: [itemRow({ 8: null })] });
    const result = await supplierQuotesRepo.listAllItems(testDb);
    expect(result[0].unitType).toBe('unit');
  });

  test('maps the duration columns (issue #776)', async () => {
    exec.enqueue({ rows: [itemRow({ 11: 18, 12: 'years' })] });
    const result = await supplierQuotesRepo.listAllItems(testDb);
    expect(result[0].durationMonths).toBe(18);
    expect(result[0].durationUnit).toBe('years');
  });

  test('defaults a null/legacy duration to one month (issue #776)', async () => {
    exec.enqueue({ rows: [itemRow({ 11: null, 12: null })] });
    const result = await supplierQuotesRepo.listAllItems(testDb);
    expect(result[0].durationMonths).toBe(1);
    expect(result[0].durationUnit).toBe('months');
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
  test('binds patch values via COALESCE, WHERE id last - no id in SET (issue #621)', async () => {
    exec.enqueue({ rows: [quoteRow()] });
    exec.enqueue({ rows: [quoteRow()] });
    await supplierQuotesRepo.update('q-1', { status: 'sent', notes: 'hi' }, testDb);
    const sql = exec.calls[0].sql;
    expect(sql).toContain('update "supplier_quotes"');
    expect(sql).toContain('COALESCE');
    expect(sql).toContain('CURRENT_TIMESTAMP');
    // The SET clause must NOT touch the primary key column.
    expect(sql).not.toMatch(/set[^"]*"id"\s*=/i);
    expect(sql).toContain('"id" = $8');
    expect(exec.calls[0].params).toHaveLength(8);
    expect(exec.calls[0].params[3]).toBe('sent'); // status
    expect(exec.calls[0].params[6]).toBe('hi'); // notes
    expect(exec.calls[0].params[7]).toBe('q-1'); // where id
  });

  test('returns null when no row updated', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.update('q-x', { status: 'sent' }, testDb)).toBeNull();
  });

  test('empty patch falls back to SELECT (no UPDATE issued, updated_at preserved)', async () => {
    exec.enqueue({ rows: [quoteRow()] });
    const result = await supplierQuotesRepo.update('q-1', {}, testDb);
    const sqlText = exec.calls[0].sql.toLowerCase();
    expect(sqlText).not.toContain('update "supplier_quotes"');
    expect(sqlText).toContain('select');
    expect(result?.id).toBe('q-1');
  });
});

describe('rename', () => {
  test('issues a dedicated UPDATE that sets the id column and returns the mapped quote', async () => {
    exec.enqueue({ rows: [quoteRow({ 0: 'q-2' })] });
    exec.enqueue({ rows: [quoteRow({ 0: 'q-2' })] });
    const result = await supplierQuotesRepo.rename('q-1', 'q-2', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('update "supplier_quotes"');
    expect(sql).toMatch(/set[^"]*"id"\s*=/);
    expect(sql).toContain('current_timestamp');
    expect(exec.calls[0].params).toContain('q-2'); // new id
    expect(exec.calls[0].params).toContain('q-1'); // where current id
    expect(result?.id).toBe('q-2');
  });

  test('returns null when no row matched currentId', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.rename('q-x', 'q-y', testDb)).toBeNull();
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
        listPrice: 5,
        discountPercent: 0,
        unitPrice: 5,
        note: null,
        unitType: 'unit',
        durationMonths: 1,
        durationUnit: 'months' as const,
      },
      {
        id: 'sqi-b',
        productId: null,
        productName: 'B',
        quantity: 2,
        listPrice: 8,
        discountPercent: 25,
        unitPrice: 6,
        note: null,
        unitType: 'unit',
        durationMonths: 1,
        durationUnit: 'months' as const,
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

  test('persists a line duration verbatim on insert — no unit-line coercion (issue #775)', async () => {
    exec.enqueue({ rows: [] }); // DELETE
    exec.enqueue({ rows: [itemRow({ 0: 'sqi-x' })] }); // INSERT ... RETURNING
    const items = [
      {
        id: 'sqi-x',
        productId: null,
        productName: 'Widget',
        quantity: 7,
        listPrice: 5,
        discountPercent: 0,
        unitPrice: 5,
        note: null,
        unitType: 'unit',
        // Duration applies to every line type now (issue #775); the repo persists the submitted
        // value/unit unchanged (covers version-restore, which rebuilds items straight from a
        // snapshot). The 'na' unit — not the line's unitType — is what disables the multiplier.
        durationMonths: 5,
        durationUnit: 'years' as const,
      },
    ];
    await supplierQuotesRepo.replaceItems('q-1', items, testDb);
    const insertParams = exec.calls[1].params;
    expect(insertParams).toContain('years');
    expect(insertParams).toContain(5);
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

describe('existsById', () => {
  test('returns true when matching row exists', async () => {
    exec.enqueue({ rows: [['q-1']] });
    expect(await supplierQuotesRepo.existsById('q-1', testDb)).toBe(true);
  });

  test('returns false when not found', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.existsById('q-x', testDb)).toBe(false);
  });
});

describe('lockStatusById', () => {
  test('uses FOR UPDATE in the emitted SQL', async () => {
    exec.enqueue({ rows: [['accepted']] });
    await supplierQuotesRepo.lockStatusById('q-1', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('for update');
    expect(exec.calls[0].params).toContain('q-1');
  });

  test('returns status row when present', async () => {
    exec.enqueue({ rows: [['accepted']] });
    expect(await supplierQuotesRepo.lockStatusById('q-1', testDb)).toEqual({ status: 'accepted' });
  });

  test('returns null when row missing', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.lockStatusById('q-x', testDb)).toBeNull();
  });
});

describe('findItemsForQuote', () => {
  test('selects items filtered by quoteId and maps them', async () => {
    exec.enqueue({ rows: [itemRow()] });
    const result = await supplierQuotesRepo.findItemsForQuote('q-1', testDb);
    expect(exec.calls[0].sql).toContain('from "supplier_quote_items"');
    expect(exec.calls[0].params).toContain('q-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('sqi-1');
  });

  test('orders rows deterministically by created_at then id', async () => {
    exec.enqueue({ rows: [] });
    await supplierQuotesRepo.findItemsForQuote('q-1', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('order by');
    expect(sql).toMatch(/"created_at".*,.*"id"/);
  });
});

describe('findFullForSnapshot', () => {
  test('returns quote and items when quote exists', async () => {
    exec.enqueue({ rows: [quoteRow()] });
    exec.enqueue({ rows: [itemRow()] });
    const result = await supplierQuotesRepo.findFullForSnapshot('q-1', testDb);
    expect(result).not.toBeNull();
    expect(result?.quote.id).toBe('q-1');
    expect(result?.items).toHaveLength(1);
  });

  test('returns null when quote not found', async () => {
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    expect(await supplierQuotesRepo.findFullForSnapshot('q-x', testDb)).toBeNull();
  });
});

describe('create', () => {
  test('inserts and returns mapped quote', async () => {
    exec.enqueue({ rows: [quoteRow()] });
    exec.enqueue({ rows: [quoteRow()] });
    const result = await supplierQuotesRepo.create(
      {
        id: 'q-1',
        supplierId: 's-1',
        supplierName: 'Acme',
        clientId: null,
        clientName: null,
        paymentTerms: 'net30',
        status: 'draft',
        expirationDate: '2026-06-01',
        communicationChannelId: 'qcc_email',
        notes: null,
      },
      testDb,
    );
    expect(exec.calls[0].sql).toContain('insert into "supplier_quotes"');
    expect(exec.calls[0].params).toContain('q-1');
    expect(exec.calls[0].params).toContain('Acme');
    expect(exec.calls[0].params).toContain('2026-06-01');
    expect(result.id).toBe('q-1');
  });

  test('persists the optional client link when provided', async () => {
    exec.enqueue({ rows: [quoteRow({ 3: 'c-1', 4: 'Globex' })] });
    exec.enqueue({ rows: [quoteRow({ 3: 'c-1', 4: 'Globex' })] });
    const result = await supplierQuotesRepo.create(
      {
        id: 'q-1',
        supplierId: 's-1',
        supplierName: 'Acme',
        clientId: 'c-1',
        clientName: 'Globex',
        paymentTerms: 'net30',
        status: 'draft',
        expirationDate: '2026-06-01',
        communicationChannelId: 'qcc_email',
        notes: null,
      },
      testDb,
    );
    expect(exec.calls[0].params).toContain('c-1');
    expect(exec.calls[0].params).toContain('Globex');
    expect(result.clientId).toBe('c-1');
    expect(result.clientName).toBe('Globex');
  });
});

describe('restoreSnapshotQuote', () => {
  test('updates with snapshot fields and returns mapped quote', async () => {
    exec.enqueue({ rows: [quoteRow()] });
    exec.enqueue({ rows: [quoteRow()] });
    const result = await supplierQuotesRepo.restoreSnapshotQuote(
      'q-1',
      {
        supplierId: 's-1',
        supplierName: 'Acme',
        clientId: null,
        clientName: null,
        paymentTerms: 'net30',
        status: 'sent',
        expirationDate: '2026-06-01',
        communicationChannelId: 'qcc_email',
        notes: 'restored',
      },
      testDb,
    );
    expect(exec.calls[0].sql).toContain('update "supplier_quotes"');
    expect(exec.calls[0].sql).toContain('CURRENT_TIMESTAMP');
    expect(exec.calls[0].params).toContain('Acme');
    expect(exec.calls[0].params).toContain('sent');
    expect(exec.calls[0].params).toContain('q-1');
    expect(result?.id).toBe('q-1');
  });

  test('returns null when no row updated', async () => {
    exec.enqueue({ rows: [] });
    const result = await supplierQuotesRepo.restoreSnapshotQuote(
      'q-x',
      {
        supplierId: 's-1',
        supplierName: 'Acme',
        clientId: null,
        clientName: null,
        paymentTerms: 'net30',
        status: 'draft',
        expirationDate: '2026-06-01',
        communicationChannelId: 'qcc_email',
        notes: null,
      },
      testDb,
    );
    expect(result).toBeNull();
  });
});
