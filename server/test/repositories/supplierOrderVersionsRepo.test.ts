import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as supplierOrderVersionsRepo from '../../repositories/supplierOrderVersionsRepo.ts';
import { type FakeExecutor, makeRow, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

// supplier_order_versions schema column order:
// id, order_id, snapshot, reason, created_by_user_id, created_at
const VERSION_BASE: readonly unknown[] = [
  'sov-1',
  'sso-1',
  { schemaVersion: 1, order: { id: 'sso-1' }, items: [] },
  'update',
  'u-1',
  new Date('2026-01-01T00:00:00Z'),
];
const versionRow = (overrides: Record<number, unknown> = {}) => makeRow(VERSION_BASE, overrides);

// listForOrder projects 5 fields in this order: id, orderId, reason, createdByUserId, createdAt.
const LIST_BASE: readonly unknown[] = [
  'sov-1',
  'sso-1',
  'update',
  'u-1',
  new Date('2026-01-01T00:00:00Z'),
];
const listRow = (overrides: Record<number, unknown> = {}) => makeRow(LIST_BASE, overrides);

describe('buildSnapshot', () => {
  test('wraps supplier order + items in a versioned envelope', () => {
    const order = {
      id: 'sso-1',
      linkedQuoteId: 'sqv-1',
      supplierId: 's-1',
      supplierName: 'Acme',
      paymentTerms: 'net30',
      discount: 5,
      discountType: 'percentage' as const,
      status: 'draft',
      notes: null,
      createdAt: 0,
      updatedAt: 0,
    };
    const items: Parameters<typeof supplierOrderVersionsRepo.buildSnapshot>[1] = [];
    const snapshot = supplierOrderVersionsRepo.buildSnapshot(order, items);
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.order).toBe(order);
    expect(snapshot.items).toBe(items);
  });
});

describe('listForOrder', () => {
  test('filters by order_id and orders newest-first', async () => {
    exec.enqueue({ rows: [listRow(), listRow({ 0: 'sov-2', 2: 'restore' })] });
    const result = await supplierOrderVersionsRepo.listForOrder('sso-1', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('from "supplier_order_versions"');
    expect(sql).toContain('"order_id" = $1');
    expect(sql).toContain('order by "supplier_order_versions"."created_at" desc');
    expect(exec.calls[0].params).toEqual(['sso-1']);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('sov-1');
    expect(result[1].reason).toBe('restore');
  });

  test('returns [] when no versions exist', async () => {
    exec.enqueue({ rows: [] });
    expect(await supplierOrderVersionsRepo.listForOrder('sso-x', testDb)).toEqual([]);
  });

  test('coerces unrecognized reason values to "update"', async () => {
    exec.enqueue({ rows: [listRow({ 2: 'mystery' })] });
    const [row] = await supplierOrderVersionsRepo.listForOrder('sso-1', testDb);
    expect(row.reason).toBe('update');
  });

  test('null createdAt falls back to 0', async () => {
    exec.enqueue({ rows: [listRow({ 4: null })] });
    const [row] = await supplierOrderVersionsRepo.listForOrder('sso-1', testDb);
    expect(row.createdAt).toBe(0);
  });
});

describe('findById', () => {
  test('scopes the WHERE on BOTH order_id and id (cross-order IDOR guard)', async () => {
    exec.enqueue({ rows: [versionRow()] });
    const result = await supplierOrderVersionsRepo.findById('sso-1', 'sov-1', testDb);
    const sql = exec.calls[0].sql.toLowerCase();
    expect(sql).toContain('"order_id" = $1');
    expect(sql).toContain('"id" = $2');
    expect(sql).toContain('limit $3');
    expect(exec.calls[0].params).toEqual(['sso-1', 'sov-1', 1]);
    expect(result?.id).toBe('sov-1');
    expect(result?.snapshot.schemaVersion).toBe(1);
  });

  test('returns null when no row matches the (orderId, versionId) pair', async () => {
    exec.enqueue({ rows: [] });
    const result = await supplierOrderVersionsRepo.findById('sso-1', 'sov-other', testDb);
    expect(result).toBeNull();
  });
});

describe('insert', () => {
  test('binds order_id, snapshot JSON, reason, createdByUserId; id gets sov- prefix', async () => {
    exec.enqueue({ rows: [versionRow({ 0: 'sov-generated' })] });
    const result = await supplierOrderVersionsRepo.insert(
      {
        orderId: 'sso-1',
        snapshot: {
          schemaVersion: 1,
          order: {
            id: 'sso-1',
            linkedQuoteId: null,
            supplierId: 's-1',
            supplierName: 'Acme',
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
    expect(exec.calls[0].sql.toLowerCase()).toContain('insert into "supplier_order_versions"');
    const generatedId = exec.calls[0].params[0] as string;
    expect(generatedId.startsWith('sov-')).toBe(true);
    expect(exec.calls[0].params).toContain('sso-1');
    expect(exec.calls[0].params).toContain('restore');
    expect(exec.calls[0].params).toContain('u-1');
    expect(result.id).toBe('sov-generated');
    expect(result.reason).toBe('update'); // mapped from versionRow's index 3 default
  });
});

describe('deleteAllForOrder', () => {
  test('issues DELETE WHERE order_id and returns rowCount', async () => {
    exec.enqueue({ rows: [], rowCount: 3 });
    const result = await supplierOrderVersionsRepo.deleteAllForOrder('sso-1', testDb);
    expect(exec.calls[0].sql.toLowerCase()).toContain('delete from "supplier_order_versions"');
    expect(exec.calls[0].sql.toLowerCase()).toContain('"order_id" = $1');
    expect(exec.calls[0].params).toEqual(['sso-1']);
    expect(result).toBe(3);
  });

  test('returns 0 when rowCount is null', async () => {
    exec.enqueue({ rows: [], rowCount: null });
    expect(await supplierOrderVersionsRepo.deleteAllForOrder('sso-x', testDb)).toBe(0);
  });
});
