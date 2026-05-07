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

  test('product stats branch fires only when canListProducts; rows map per-supplier', async () => {
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
    // Promise.all order: quoteStatsPromise (null) then productStatsPromise.
    exec.enqueue({
      rows: [
        { supplier_id: 's1', product_count: '7' },
        { supplier_id: 'unknown', product_count: '99' },
      ],
    });
    const result = await repo.getSuppliersSection(
      {
        fromDate: FROM,
        toDate: TO,
        canViewSupplierQuotes: false,
        canListProducts: true,
        itemsLimit: 50,
      },
      testDb,
    );
    expect(exec.calls).toHaveLength(3);
    expect(result.activitySummary).toEqual([
      {
        supplierId: 's1',
        quotesCount: null,
        quotesNet: null,
        productsCount: 7,
      },
    ]);
  });

  test('quote stats rows for unknown supplier_ids are silently ignored', async () => {
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
    exec.enqueue({ rows: [{ supplier_id: 'unknown', quote_count: '99', net_value: '999' }] });
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
    expect(result.activitySummary[0]).toEqual({
      supplierId: 's1',
      quotesCount: null,
      quotesNet: null,
      productsCount: null,
    });
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

  test('byMonth/byStatus/topSuppliersByNet rows are mapped through helpers', async () => {
    // Promise.all order: totals, byStatus, byMonth, topSuppliers, topQuotes.
    exec.enqueue({ rows: [{ count: '0', total_net: '0', avg_net: '0' }] });
    exec.enqueue({ rows: [{ status: 'sent', count: '4', total_net: '900' }] });
    exec.enqueue({ rows: [{ label: '2026-01', count: '4', total_net: '900' }] });
    exec.enqueue({ rows: [{ label: 'ACorp', quote_count: '4', value: '900' }] });
    exec.enqueue({ rows: [] });

    const result = await repo.getSupplierQuotesSection(
      { fromDate: FROM, toDate: TO, topLimit: 10 },
      testDb,
    );
    expect(result.byStatus).toEqual([{ status: 'sent', count: 4, totalNet: 900 }]);
    expect(result.byMonth).toEqual([{ label: '2026-01', count: 4, totalNet: 900 }]);
    expect(result.topSuppliersByNet).toEqual([{ label: 'ACorp', value: 900, quoteCount: 4 }]);
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

  test('byType / byCategory / bySubcategory / productsBySupplier / top* rows are mapped through helpers', async () => {
    // Promise.all order: counts, byType, byCategory, bySubcategory, productsBySupplier,
    // topProductsByUsage, topProductsByRevenue.
    exec.enqueue({
      rows: [{ internal_count: '0', external_count: '0', disabled_count: '0' }],
    });
    exec.enqueue({ rows: [{ label: 'service', value: '5' }] });
    exec.enqueue({ rows: [{ label: 'consulting', value: '4' }] });
    exec.enqueue({ rows: [{ label: 'training', value: '3' }] });
    exec.enqueue({ rows: [{ label: 'ACorp', value: '2' }] });
    exec.enqueue({
      rows: [
        {
          product_id: 'p1',
          product_name: 'Widget',
          usage_count: '7',
          quantity_total: '15',
        },
      ],
    });
    exec.enqueue({ rows: [{ product_id: 'p2', product_name: 'Gadget', value: '420' }] });

    const result = await repo.getCatalogSection(
      { fromDate: FROM, toDate: TO, topLimit: 10 },
      testDb,
    );
    expect(result.byType).toEqual([{ label: 'service', value: 5 }]);
    expect(result.byCategory).toEqual([{ label: 'consulting', value: 4 }]);
    expect(result.bySubcategory).toEqual([{ label: 'training', value: 3 }]);
    expect(result.productsBySupplierCount).toEqual([{ label: 'ACorp', value: 2 }]);
    expect(result.topProductsByUsage).toEqual([
      { productId: 'p1', productName: 'Widget', usageCount: 7, quantity: 15 },
    ]);
    expect(result.topProductsByRevenue).toEqual([
      { productId: 'p2', productName: 'Gadget', value: 420 },
    ]);
  });
});
