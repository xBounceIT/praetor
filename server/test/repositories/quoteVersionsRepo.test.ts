import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as quoteVersionsRepo from '../../repositories/quoteVersionsRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// quote_versions schema column order:
// id, quote_id, snapshot, reason, created_by_user_id, created_at
const VERSION_BASE: readonly unknown[] = [
  'qv-1',
  'cq-1',
  { schemaVersion: 1, quote: { id: 'cq-1' }, items: [] },
  'update',
  'u-1',
  new Date('2026-01-01T00:00:00Z'),
];
const versionRow = (overrides: Record<number, unknown> = {}) => makeRow(VERSION_BASE, overrides);

// listForQuote projects 5 fields in this order: id, quoteId, reason, createdByUserId, createdAt.
const LIST_BASE: readonly unknown[] = [
  'qv-1',
  'cq-1',
  'update',
  'u-1',
  new Date('2026-01-01T00:00:00Z'),
];
const listRow = (overrides: Record<number, unknown> = {}) => makeRow(LIST_BASE, overrides);

describe('buildSnapshot', () => {
  test('preserves linkedOfferId on the snapshot so the historical record is complete', () => {
    const quote = {
      id: 'cq-1',
      linkedOfferId: 'co-1',
      clientId: 'c-1',
      clientName: 'Acme',
      paymentTerms: 'net30',
      discount: 5,
      discountType: 'percentage' as const,
      status: 'draft',
      expirationDate: '2026-06-01',
      communicationChannelId: 'qcc_email',
      communicationChannelName: 'Email',
      notes: null,
      createdAt: 0,
      updatedAt: 0,
    };
    const items: Parameters<typeof quoteVersionsRepo.buildSnapshot>[1] = [];
    const snapshot = quoteVersionsRepo.buildSnapshot(quote, items);
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.items).toBe(items);
    expect(snapshot.quote.id).toBe('cq-1');
    expect(snapshot.quote.clientId).toBe('c-1');
    // linkedOfferId now round-trips through the snapshot for audit/portability.
    expect(snapshot.quote.linkedOfferId).toBe('co-1');
  });

  test('null linkedOfferId round-trips faithfully', () => {
    const quote = {
      id: 'cq-2',
      linkedOfferId: null,
      clientId: 'c-1',
      clientName: 'Acme',
      paymentTerms: 'net30',
      discount: 0,
      discountType: 'percentage' as const,
      status: 'draft',
      expirationDate: '2026-06-01',
      communicationChannelId: 'qcc_email',
      communicationChannelName: 'Email',
      notes: null,
      createdAt: 0,
      updatedAt: 0,
    };
    const snapshot = quoteVersionsRepo.buildSnapshot(quote, []);
    expect(snapshot.quote.linkedOfferId).toBeNull();
  });
});

describe('listForQuote', () => {
  test('filters by quote_id and orders newest-first', async () => {
    exec.enqueue({ rows: [listRow(), listRow({ 0: 'qv-2', 2: 'restore' })] });
    const result = await quoteVersionsRepo.listForQuote('cq-1', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('from "quote_versions"');
    expect(sql).toContain('"quote_id" = $1');
    expect(sql).toContain('order by "quote_versions"."created_at" desc');
    expect(exec.calls[0].params).toEqual(['cq-1']);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('qv-1');
    expect(result[1].reason).toBe('restore');
  });

  test('returns [] when no versions exist', async () => {
    exec.enqueue({ rows: [] });
    expect(await quoteVersionsRepo.listForQuote('cq-x', testDb)).toEqual([]);
  });

  test('coerces unrecognized reason values to "update"', async () => {
    exec.enqueue({ rows: [listRow({ 2: 'mystery' })] });
    const [row] = await quoteVersionsRepo.listForQuote('cq-1', testDb);
    expect(row.reason).toBe('update');
  });

  test('null createdAt falls back to 0', async () => {
    exec.enqueue({ rows: [listRow({ 4: null })] });
    const [row] = await quoteVersionsRepo.listForQuote('cq-1', testDb);
    expect(row.createdAt).toBe(0);
  });
});

describe('findById', () => {
  test('scopes the WHERE on BOTH quote_id and id (cross-quote IDOR guard)', async () => {
    exec.enqueue({ rows: [versionRow()] });
    const result = await quoteVersionsRepo.findById('cq-1', 'qv-1', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('"quote_id" = $1');
    expect(sql).toContain('"id" = $2');
    expect(sql).toContain('limit $3');
    expect(exec.calls[0].params).toEqual(['cq-1', 'qv-1', 1]);
    expect(result?.id).toBe('qv-1');
    expect(result?.snapshot.schemaVersion).toBe(1);
  });

  test('returns null when no row matches the (quoteId, versionId) pair', async () => {
    exec.enqueue({ rows: [] });
    const result = await quoteVersionsRepo.findById('cq-1', 'qv-other', testDb);
    expect(result).toBeNull();
  });
});

describe('insert', () => {
  test('binds quote_id, snapshot JSON, reason, createdByUserId; id gets qv- prefix', async () => {
    exec.enqueue({ rows: [versionRow({ 0: 'qv-generated' })] });
    const result = await quoteVersionsRepo.insert(
      {
        quoteId: 'cq-1',
        snapshot: {
          schemaVersion: 1,
          quote: {
            id: 'cq-1',
            clientId: 'c-1',
            clientName: 'Acme',
            paymentTerms: 'net30',
            discount: 5,
            discountType: 'percentage',
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
    expect(exec.calls[0].sql.toLowerCase()).toContain('insert into "quote_versions"');
    const generatedId = exec.calls[0].params[0] as string;
    expect(generatedId.startsWith('qv-')).toBe(true);
    expect(exec.calls[0].params).toContain('cq-1');
    expect(exec.calls[0].params).toContain('restore');
    expect(exec.calls[0].params).toContain('u-1');
    expect(result.id).toBe('qv-generated');
    expect(result.reason).toBe('update'); // mapped from versionRow's index 3 default
  });
});

describe('deleteAllForQuote', () => {
  test('issues DELETE WHERE quote_id and returns rowCount', async () => {
    exec.enqueue({ rows: [], rowCount: 3 });
    const result = await quoteVersionsRepo.deleteAllForQuote('cq-1', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('delete from "quote_versions"');
    expect(exec.calls[0].sql.toLowerCase()).toContain('"quote_id" = $1');
    expect(exec.calls[0].params).toEqual(['cq-1']);
    expect(result).toBe(3);
  });

  test('returns 0 when rowCount is null', async () => {
    exec.enqueue({ rows: [], rowCount: null });
    expect(await quoteVersionsRepo.deleteAllForQuote('cq-x', testDb)).toBe(0);
  });
});
