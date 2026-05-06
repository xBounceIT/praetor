import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as offerVersionsRepo from '../../repositories/offerVersionsRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// offer_versions schema column order:
// id, offer_id, snapshot, reason, created_by_user_id, created_at
const VERSION_BASE: readonly unknown[] = [
  'ov-1',
  'co-1',
  { schemaVersion: 1, offer: { id: 'co-1' }, items: [] },
  'update',
  'u-1',
  new Date('2026-01-01T00:00:00Z'),
];
const versionRow = (overrides: Record<number, unknown> = {}) => makeRow(VERSION_BASE, overrides);

// listForOffer projects 5 fields in this order: id, offerId, reason, createdByUserId, createdAt.
const LIST_BASE: readonly unknown[] = [
  'ov-1',
  'co-1',
  'update',
  'u-1',
  new Date('2026-01-01T00:00:00Z'),
];
const listRow = (overrides: Record<number, unknown> = {}) => makeRow(LIST_BASE, overrides);

describe('buildSnapshot', () => {
  test('wraps offer + items in a versioned envelope', () => {
    const offer = {
      id: 'co-1',
      linkedQuoteId: 'cq-1',
      clientId: 'c-1',
      clientName: 'Acme',
      paymentTerms: 'net30',
      discount: 5,
      discountType: 'percentage' as const,
      status: 'draft',
      expirationDate: '2026-06-01',
      notes: null,
      createdAt: 0,
      updatedAt: 0,
    };
    const items: Parameters<typeof offerVersionsRepo.buildSnapshot>[1] = [];
    const snapshot = offerVersionsRepo.buildSnapshot(offer, items);
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.offer).toBe(offer);
    expect(snapshot.items).toBe(items);
  });
});

describe('listForOffer', () => {
  test('filters by offer_id and orders newest-first', async () => {
    exec.enqueue({ rows: [listRow(), listRow({ 0: 'ov-2', 2: 'restore' })] });
    const result = await offerVersionsRepo.listForOffer('co-1', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('from "offer_versions"');
    expect(sql).toContain('"offer_id" = $1');
    expect(sql).toContain('order by "offer_versions"."created_at" desc');
    expect(exec.calls[0].params).toEqual(['co-1']);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('ov-1');
    expect(result[1].reason).toBe('restore');
  });

  test('returns [] when no versions exist', async () => {
    exec.enqueue({ rows: [] });
    expect(await offerVersionsRepo.listForOffer('co-x', testDb)).toEqual([]);
  });

  test('coerces unrecognized reason values to "update"', async () => {
    exec.enqueue({ rows: [listRow({ 2: 'mystery' })] });
    const [row] = await offerVersionsRepo.listForOffer('co-1', testDb);
    expect(row.reason).toBe('update');
  });

  test('null createdAt falls back to 0', async () => {
    exec.enqueue({ rows: [listRow({ 4: null })] });
    const [row] = await offerVersionsRepo.listForOffer('co-1', testDb);
    expect(row.createdAt).toBe(0);
  });
});

describe('findById', () => {
  test('scopes the WHERE on BOTH offer_id and id (cross-offer IDOR guard)', async () => {
    exec.enqueue({ rows: [versionRow()] });
    const result = await offerVersionsRepo.findById('co-1', 'ov-1', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('"offer_id" = $1');
    expect(sql).toContain('"id" = $2');
    expect(sql).toContain('limit $3');
    expect(exec.calls[0].params).toEqual(['co-1', 'ov-1', 1]);
    expect(result?.id).toBe('ov-1');
    expect(result?.snapshot.schemaVersion).toBe(1);
  });

  test('returns null when no row matches the (offerId, versionId) pair', async () => {
    exec.enqueue({ rows: [] });
    const result = await offerVersionsRepo.findById('co-1', 'ov-other', testDb);
    expect(result).toBeNull();
  });
});

describe('insert', () => {
  test('binds offer_id, snapshot JSON, reason, createdByUserId; id gets ov- prefix', async () => {
    exec.enqueue({ rows: [versionRow({ 0: 'ov-generated' })] });
    const result = await offerVersionsRepo.insert(
      {
        offerId: 'co-1',
        snapshot: {
          schemaVersion: 1,
          offer: {
            id: 'co-1',
            linkedQuoteId: 'cq-1',
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
    expect(exec.calls[0].sql.toLowerCase()).toContain('insert into "offer_versions"');
    const generatedId = exec.calls[0].params[0] as string;
    expect(generatedId.startsWith('ov-')).toBe(true);
    expect(exec.calls[0].params).toContain('co-1');
    expect(exec.calls[0].params).toContain('restore');
    expect(exec.calls[0].params).toContain('u-1');
    expect(result.id).toBe('ov-generated');
    expect(result.reason).toBe('update'); // mapped from versionRow's index 3 default
  });
});

describe('deleteAllForOffer', () => {
  test('issues DELETE WHERE offer_id and returns rowCount', async () => {
    exec.enqueue({ rows: [], rowCount: 3 });
    const result = await offerVersionsRepo.deleteAllForOffer('co-1', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('delete from "offer_versions"');
    expect(exec.calls[0].sql.toLowerCase()).toContain('"offer_id" = $1');
    expect(exec.calls[0].params).toEqual(['co-1']);
    expect(result).toBe(3);
  });

  test('returns 0 when rowCount is null', async () => {
    exec.enqueue({ rows: [], rowCount: null });
    expect(await offerVersionsRepo.deleteAllForOffer('co-x', testDb)).toBe(0);
  });
});
