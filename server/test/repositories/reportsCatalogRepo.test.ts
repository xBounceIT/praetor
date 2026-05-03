import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as repo from '../../repositories/reportsCatalogRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

const FROM = '2026-01-01';
const TO = '2026-01-31';

describe('getSuppliersSection', () => {
  test('summary + list run in parallel; activity branches skipped when no suppliers', async () => {
    exec.enqueueEmptyN(2);
    await repo.getSuppliersSection(
      {
        fromDate: FROM,
        toDate: TO,
        canViewSupplierQuotes: true,
        canListProducts: true,
        itemsLimit: 50,
      },
      testDb,
    );
    expect(exec.calls).toHaveLength(2);
  });

  test('counts + activeCount derived correctly', async () => {
    exec.enqueue({ rows: [{ count: '10', disabled_count: '3' }] });
    exec.enqueue({ rows: [] });
    const result = await repo.getSuppliersSection(
      {
        fromDate: FROM,
        toDate: TO,
        canViewSupplierQuotes: false,
        canListProducts: false,
        itemsLimit: 50,
      },
      testDb,
    );
    expect(result).toMatchObject({ count: 10, activeCount: 7, disabledCount: 3 });
  });

  test('activity branches fire only when permission granted; quote stats map per-supplier', async () => {
    exec.enqueue({ rows: [{ count: '1', disabled_count: '0' }] });
    exec.enqueue({
      rows: [
        {
          id: 's1',
          name: 'ACorp',
          supplier_code: null,
          contact_name: null,
          email: null,
          phone: null,
          address: null,
          is_disabled: false,
        },
      ],
    });
    exec.enqueue({ rows: [{ supplier_id: 's1', quote_count: '4', net_value: '900' }] });

    const result = await repo.getSuppliersSection(
      {
        fromDate: FROM,
        toDate: TO,
        canViewSupplierQuotes: true,
        canListProducts: false,
        itemsLimit: 50,
      },
      testDb,
    );
    expect(exec.calls).toHaveLength(3);
    expect(result.activitySummary).toEqual([
      {
        supplierId: 's1',
        quotesCount: 4,
        quotesNet: 900,
        productsCount: null,
      },
    ]);
  });
});

describe('getSupplierQuotesSection', () => {
  test('dispatches 5 parallel queries on supplier_quotes', async () => {
    exec.enqueueEmptyN(5);
    await repo.getSupplierQuotesSection({ fromDate: FROM, toDate: TO, topLimit: 10 }, testDb);
    expect(exec.calls).toHaveLength(5);
    for (const call of exec.calls) {
      expect(call.sql).toContain('FROM supplier_quotes sq');
      expect(call.params[0]).toBe(FROM);
      expect(call.params[1]).toBe(TO);
    }
  });

  test('LIMIT queries pass topLimit as $3 (parameterized, not interpolated)', async () => {
    exec.enqueueEmptyN(5);
    await repo.getSupplierQuotesSection({ fromDate: FROM, toDate: TO, topLimit: 7 }, testDb);
    const limited = exec.calls.filter((c) => /LIMIT \$\d+/.test(c.sql));
    expect(limited.length).toBeGreaterThan(0);
    for (const call of limited) {
      expect(call.sql).toContain('LIMIT $3');
      expect(call.params).toContain(7);
    }
  });

  test('topQuotesByNet maps id into both id and purchaseOrderNumber', async () => {
    exec.enqueueEmptyN(4);
    exec.enqueue({
      rows: [
        {
          id: 'sq1',
          supplier_name: 'ACorp',
          status: 'sent',
          net_value: '500',
          created_at: '1700000000000',
        },
      ],
    });
    const result = await repo.getSupplierQuotesSection(
      { fromDate: FROM, toDate: TO, topLimit: 10 },
      testDb,
    );
    expect(result.topQuotesByNet).toEqual([
      {
        id: 'sq1',
        supplierName: 'ACorp',
        purchaseOrderNumber: 'sq1',
        status: 'sent',
        netValue: 500,
        createdAt: 1700000000000,
      },
    ]);
  });
});

describe('getCatalogSection', () => {
  test('dispatches 7 parallel queries (counts + 4 breakdowns + 2 top lists)', async () => {
    exec.enqueueEmptyN(7);
    await repo.getCatalogSection({ fromDate: FROM, toDate: TO, topLimit: 10 }, testDb);
    expect(exec.calls).toHaveLength(7);
  });

  test('productCounts maps internal/external/disabled', async () => {
    exec.enqueue({
      rows: [{ internal_count: '5', external_count: '3', disabled_count: '1' }],
    });
    exec.enqueueEmptyN(6);
    const result = await repo.getCatalogSection(
      { fromDate: FROM, toDate: TO, topLimit: 10 },
      testDb,
    );
    expect(result.productCounts).toEqual({ internal: 5, external: 3, disabled: 1 });
  });

  test('productsBySupplier query has [topLimit] as the only param (LIMIT $1)', async () => {
    exec.enqueueEmptyN(7);
    await repo.getCatalogSection({ fromDate: FROM, toDate: TO, topLimit: 12 }, testDb);
    const productsBySupplierCall = exec.calls.find((c) => c.sql.includes('LEFT JOIN suppliers'));
    expect(productsBySupplierCall?.params).toEqual([12]);
    expect(productsBySupplierCall?.sql).toContain('LIMIT $1');
  });

  test('top usage query binds [from, to] per UNION ALL leg + topLimit (7 params, LIMIT $7)', async () => {
    exec.enqueueEmptyN(7);
    await repo.getCatalogSection({ fromDate: FROM, toDate: TO, topLimit: 8 }, testDb);
    const usageCall = exec.calls.find((c) => c.sql.includes('WITH usage_rows'));
    expect(usageCall?.params).toEqual([FROM, TO, FROM, TO, FROM, TO, 8]);
    expect(usageCall?.sql).toContain('LIMIT $7');
  });
});
