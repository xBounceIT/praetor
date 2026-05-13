import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as orderVersionsRepo from '../../repositories/orderVersionsRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// order_versions schema column order:
// id, order_id, snapshot, reason, created_by_user_id, created_at
const VERSION_BASE: readonly unknown[] = [
  'ov-1',
  'so-1',
  { schemaVersion: 1, order: { id: 'so-1' }, items: [] },
  'update',
  'u-1',
  new Date('2026-01-01T00:00:00Z'),
];
const versionRow = (overrides: Record<number, unknown> = {}) => makeRow(VERSION_BASE, overrides);

// listForOrder projects 5 fields in this order: id, orderId, reason, createdByUserId, createdAt.
const LIST_BASE: readonly unknown[] = [
  'ov-1',
  'so-1',
  'update',
  'u-1',
  new Date('2026-01-01T00:00:00Z'),
];
const listRow = (overrides: Record<number, unknown> = {}) => makeRow(LIST_BASE, overrides);

describe('buildSnapshot', () => {
  test('preserves linkedQuoteId and linkedOfferId on the snapshot for restore round-trip', () => {
    const order = {
      id: 'so-1',
      linkedQuoteId: 'cq-1',
      linkedOfferId: 'co-1',
      clientId: 'c-1',
      clientName: 'Acme',
      paymentTerms: 'net30',
      discount: 5,
      discountType: 'percentage' as const,
      status: 'draft',
      notes: null,
      createdAt: 0,
      updatedAt: 0,
    };
    const items: Parameters<typeof orderVersionsRepo.buildSnapshot>[1] = [];
    const snapshot = orderVersionsRepo.buildSnapshot(order, items);
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.items).toBe(items);
    expect(snapshot.order.id).toBe('so-1');
    expect(snapshot.order.clientId).toBe('c-1');
    // linkedQuoteId / linkedOfferId are real columns on `sales`, so the restore path needs them.
    expect(snapshot.order.linkedQuoteId).toBe('cq-1');
    expect(snapshot.order.linkedOfferId).toBe('co-1');
  });

  test('null link IDs round-trip faithfully', () => {
    const order = {
      id: 'so-2',
      linkedQuoteId: null,
      linkedOfferId: null,
      clientId: 'c-1',
      clientName: 'Acme',
      paymentTerms: 'net30',
      discount: 0,
      discountType: 'percentage' as const,
      status: 'draft',
      notes: null,
      createdAt: 0,
      updatedAt: 0,
    };
    const snapshot = orderVersionsRepo.buildSnapshot(order, []);
    expect(snapshot.order.linkedQuoteId).toBeNull();
    expect(snapshot.order.linkedOfferId).toBeNull();
  });
});

describe('listForOrder', () => {
  test('filters by order_id and orders newest-first', async () => {
    exec.enqueue({ rows: [listRow(), listRow({ 0: 'ov-2', 2: 'restore' })] });
    const result = await orderVersionsRepo.listForOrder('so-1', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('from "order_versions"');
    expect(sql).toContain('"order_id" = $1');
    expect(sql).toContain('order by "order_versions"."created_at" desc');
    expect(exec.calls[0].params).toEqual(['so-1']);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('ov-1');
    expect(result[1].reason).toBe('restore');
  });

  test('returns [] when no versions exist', async () => {
    exec.enqueue({ rows: [] });
    expect(await orderVersionsRepo.listForOrder('so-x', testDb)).toEqual([]);
  });

  test('coerces unrecognized reason values to "update"', async () => {
    exec.enqueue({ rows: [listRow({ 2: 'mystery' })] });
    const [row] = await orderVersionsRepo.listForOrder('so-1', testDb);
    expect(row.reason).toBe('update');
  });

  test('null createdAt falls back to 0', async () => {
    exec.enqueue({ rows: [listRow({ 4: null })] });
    const [row] = await orderVersionsRepo.listForOrder('so-1', testDb);
    expect(row.createdAt).toBe(0);
  });
});

describe('findById', () => {
  test('scopes the WHERE on BOTH order_id and id (cross-order IDOR guard)', async () => {
    exec.enqueue({ rows: [versionRow()] });
    const result = await orderVersionsRepo.findById('so-1', 'ov-1', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('"order_id" = $1');
    expect(sql).toContain('"id" = $2');
    expect(sql).toContain('limit $3');
    expect(exec.calls[0].params).toEqual(['so-1', 'ov-1', 1]);
    expect(result?.id).toBe('ov-1');
    expect(result?.snapshot.schemaVersion).toBe(1);
  });

  test('returns null when no row matches the (orderId, versionId) pair', async () => {
    exec.enqueue({ rows: [] });
    const result = await orderVersionsRepo.findById('so-1', 'ov-other', testDb);
    expect(result).toBeNull();
  });
});

describe('insert', () => {
  test('binds order_id, snapshot JSON, reason, createdByUserId; id gets ov- prefix', async () => {
    exec.enqueue({ rows: [versionRow({ 0: 'ov-generated' })] });
    const result = await orderVersionsRepo.insert(
      {
        orderId: 'so-1',
        snapshot: {
          schemaVersion: 1,
          order: {
            id: 'so-1',
            clientId: 'c-1',
            clientName: 'Acme',
            paymentTerms: 'net30',
            discount: 5,
            discountType: 'percentage',
            status: 'draft',
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
    expect(exec.calls[0].sql.toLowerCase()).toContain('insert into "order_versions"');
    const generatedId = exec.calls[0].params[0] as string;
    expect(generatedId.startsWith('ov-')).toBe(true);
    expect(exec.calls[0].params).toContain('so-1');
    expect(exec.calls[0].params).toContain('restore');
    expect(exec.calls[0].params).toContain('u-1');
    expect(result.id).toBe('ov-generated');
    expect(result.reason).toBe('update'); // mapped from versionRow's index 3 default
  });
});

describe('deleteAllForOrder', () => {
  test('issues DELETE WHERE order_id and returns rowCount', async () => {
    exec.enqueue({ rows: [], rowCount: 3 });
    const result = await orderVersionsRepo.deleteAllForOrder('so-1', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('delete from "order_versions"');
    expect(exec.calls[0].sql.toLowerCase()).toContain('"order_id" = $1');
    expect(exec.calls[0].params).toEqual(['so-1']);
    expect(result).toBe(3);
  });

  test('returns 0 when rowCount is null', async () => {
    exec.enqueue({ rows: [], rowCount: null });
    expect(await orderVersionsRepo.deleteAllForOrder('so-x', testDb)).toBe(0);
  });
});
