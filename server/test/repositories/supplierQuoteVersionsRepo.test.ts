import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as supplierQuoteVersionsRepo from '../../repositories/supplierQuoteVersionsRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// supplier_quote_versions schema column order:
// id, quote_id, snapshot, reason, created_by_user_id, created_at
const VERSION_BASE: readonly unknown[] = [
  'sqv-1',
  'sq-1',
  { schemaVersion: 1, quote: { id: 'sq-1' }, items: [] },
  'update',
  'u-1',
  new Date('2026-01-01T00:00:00Z'),
];
const versionRow = (overrides: Record<number, unknown> = {}) => makeRow(VERSION_BASE, overrides);

// listForQuote projects 5 fields in this order: id, quoteId, reason, createdByUserId, createdAt.
const LIST_BASE: readonly unknown[] = [
  'sqv-1',
  'sq-1',
  'update',
  'u-1',
  new Date('2026-01-01T00:00:00Z'),
];
const listRow = (overrides: Record<number, unknown> = {}) => makeRow(LIST_BASE, overrides);

describe('buildSnapshot', () => {
  test('preserves linkedOrderId on the supplier-quote snapshot for audit/portability', () => {
    const quote = {
      id: 'sq-1',
      supplierId: 's-1',
      supplierName: 'Acme',
      clientId: null,
      clientName: null,
      paymentTerms: 'net30',
      status: 'draft',
      expirationDate: '2026-06-01',
      linkedOrderId: 'sso-1',
      notes: null,
      createdAt: 0,
      updatedAt: 0,
    };
    const items: Parameters<typeof supplierQuoteVersionsRepo.buildSnapshot>[1] = [];
    const snapshot = supplierQuoteVersionsRepo.buildSnapshot(quote, items);
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.items).toBe(items);
    expect(snapshot.quote.id).toBe('sq-1');
    expect(snapshot.quote.supplierId).toBe('s-1');
    // linkedOrderId now round-trips through the snapshot.
    expect(snapshot.quote.linkedOrderId).toBe('sso-1');
  });

  test('null linkedOrderId round-trips faithfully', () => {
    const quote = {
      id: 'sq-2',
      supplierId: 's-1',
      supplierName: 'Acme',
      clientId: null,
      clientName: null,
      paymentTerms: 'net30',
      status: 'draft',
      expirationDate: '2026-06-01',
      linkedOrderId: null,
      notes: null,
      createdAt: 0,
      updatedAt: 0,
    };
    const snapshot = supplierQuoteVersionsRepo.buildSnapshot(quote, []);
    expect(snapshot.quote.linkedOrderId).toBeNull();
  });
});

describe('listForQuote', () => {
  test('filters by quote_id and orders newest-first', async () => {
    exec.enqueue({ rows: [listRow(), listRow({ 0: 'sqv-2', 2: 'restore' })] });
    const result = await supplierQuoteVersionsRepo.listForQuote('sq-1', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('from "supplier_quote_versions"');
    expect(sql).toContain('"quote_id" = $1');
    expect(sql).toContain('order by "supplier_quote_versions"."created_at" desc');
    expect(exec.calls[0].params).toEqual(['sq-1']);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('sqv-1');
    expect(result[1].reason).toBe('restore');
  });

  test('returns [] when no versions exist', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierQuoteVersionsRepo.listForQuote('sq-x', testDb)).toEqual([]);
  });

  test('coerces unrecognized reason values to "update"', async () => {
    exec.enqueue({ rows: [listRow({ 2: 'mystery' })] });
    const [row] = await supplierQuoteVersionsRepo.listForQuote('sq-1', testDb);
    expect(row.reason).toBe('update');
  });

  test('null createdAt falls back to 0', async () => {
    exec.enqueue({ rows: [listRow({ 4: null })] });
    const [row] = await supplierQuoteVersionsRepo.listForQuote('sq-1', testDb);
    expect(row.createdAt).toBe(0);
  });
});

describe('findById', () => {
  test('scopes the WHERE on BOTH quote_id and id (cross-quote IDOR guard)', async () => {
    exec.enqueue({ rows: [versionRow()] });
    const result = await supplierQuoteVersionsRepo.findById('sq-1', 'sqv-1', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('"quote_id" = $1');
    expect(sql).toContain('"id" = $2');
    expect(sql).toContain('limit $3');
    expect(exec.calls[0].params).toEqual(['sq-1', 'sqv-1', 1]);
    expect(result?.id).toBe('sqv-1');
    expect(result?.snapshot.schemaVersion).toBe(1);
  });

  test('returns null when no row matches the (quoteId, versionId) pair', async () => {
    exec.enqueue({ rows: [] });
    const result = await supplierQuoteVersionsRepo.findById('sq-1', 'sqv-other', testDb);
    expect(result).toBeNull();
  });
});

describe('insert', () => {
  test('binds quote_id, snapshot JSON, reason, createdByUserId; id gets sqv- prefix', async () => {
    exec.enqueue({ rows: [versionRow({ 0: 'sqv-generated' })] });
    const result = await supplierQuoteVersionsRepo.insert(
      {
        quoteId: 'sq-1',
        snapshot: {
          schemaVersion: 1,
          quote: {
            id: 'sq-1',
            supplierId: 's-1',
            supplierName: 'Acme',
            clientId: null,
            clientName: null,
            paymentTerms: 'net30',
            status: 'draft',
            expirationDate: '2026-06-01',
            notes: null,
            createdAt: 0,
            updatedAt: 0,
          },
          items: [],
        },
        reason: 'restore',
        createdByUserId: 'u-1',
      },
      testDb,
    );
    expect(exec.calls[0].sql.toLowerCase()).toContain('insert into "supplier_quote_versions"');
    const generatedId = exec.calls[0].params[0] as string;
    expect(generatedId.startsWith('sqv-')).toBe(true);
    expect(exec.calls[0].params).toContain('sq-1');
    expect(exec.calls[0].params).toContain('restore');
    expect(exec.calls[0].params).toContain('u-1');
    expect(result.id).toBe('sqv-generated');
    expect(result.reason).toBe('update'); // mapped from versionRow's index 3 default
  });
});

describe('deleteAllForQuote', () => {
  test('issues DELETE WHERE quote_id and returns rowCount', async () => {
    exec.enqueue({ rows: [], rowCount: 3 });
    const result = await supplierQuoteVersionsRepo.deleteAllForQuote('sq-1', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('delete from "supplier_quote_versions"');
    expect(exec.calls[0].sql.toLowerCase()).toContain('"quote_id" = $1');
    expect(exec.calls[0].params).toEqual(['sq-1']);
    expect(result).toBe(3);
  });

  test('returns 0 when rowCount is null', async () => {
    exec.enqueue({ rows: [], rowCount: null });
    expect(await supplierQuoteVersionsRepo.deleteAllForQuote('sq-x', testDb)).toBe(0);
  });
});
