import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as repo from '../../repositories/reportsBusinessDocsRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

const OPTIONS = { fromDate: '2026-04-01', toDate: '2026-07-31', topLimit: 10 };

describe('commercial document datasets', () => {
  test('client offers include duration and both line/header discount models', async () => {
    exec.enqueueEmptyN(5);

    await repo.getClientOffersSection(OPTIONS, testDb);

    expect(exec.calls).toHaveLength(5);
    for (const call of exec.calls) {
      expect(call.sql).toContain('FROM customer_offers co');
      expect(call.sql).toContain('COALESCE(coi.duration_months, 1)');
      expect(call.sql).toContain("coi.duration_unit = 'na'");
      expect(call.sql).toContain("co.discount_type = 'currency'");
      expect(call.params.slice(0, 2)).toEqual([OPTIONS.fromDate, OPTIONS.toDate]);
    }
  });

  test('supplier orders include duration and map generic document/partner rankings', async () => {
    exec.enqueue({ rows: [{ count: '2', total_net: '1200', avg_net: '600' }] });
    exec.enqueue({ rows: [{ status: 'sent', count: '2', total_net: '1200' }] });
    exec.enqueue({ rows: [{ label: '2026-06', count: '2', total_net: '1200' }] });
    exec.enqueue({
      rows: [
        {
          id: 'so-1',
          partner_name: 'Vendor',
          status: 'sent',
          due_date: null,
          net_value: '900',
          created_at: '1700000000000',
        },
      ],
    });
    exec.enqueue({ rows: [{ label: 'Vendor', document_count: '2', value: '1200' }] });

    const result = await repo.getSupplierOrdersSection(OPTIONS, testDb);

    expect(exec.calls[0].sql).toContain('COALESCE(ssi.duration_months, 1)');
    expect(exec.calls[0].sql).toContain("ssi.duration_unit = 'na'");
    expect(result.totals).toEqual({ count: 2, totalNet: 1200, avgNet: 600 });
    expect(result.topDocumentsByNet[0]).toEqual({
      id: 'so-1',
      partnerName: 'Vendor',
      status: 'sent',
      dueDate: '',
      netValue: 900,
      createdAt: 1700000000000,
    });
    expect(result.topPartnersByNet).toEqual([{ label: 'Vendor', value: 1200, documentCount: 2 }]);
  });
});

describe('getSupplierInvoicesSection', () => {
  test('maps payable totals, aging, and supplier exposure', async () => {
    exec.enqueue({
      rows: [{ count: '3', total_sum: '1000', outstanding_sum: '250', paid_sum: '750' }],
    });
    exec.enqueue({
      rows: [{ status: 'overdue', count: '1', total_sum: '250', outstanding_sum: '250' }],
    });
    exec.enqueue({
      rows: [{ label: '2026-06', count: '3', total_sum: '1000', outstanding_sum: '250' }],
    });
    exec.enqueue({ rows: [{ bucket: '31-60', count: '1', outstanding_sum: '250' }] });
    exec.enqueue({
      rows: [
        {
          id: 'si-1',
          supplier_name: 'Vendor',
          status: 'overdue',
          due_date: '2026-06-01',
          outstanding: '250',
        },
      ],
    });
    exec.enqueue({ rows: [{ label: 'Vendor', invoice_count: '1', value: '250' }] });

    const result = await repo.getSupplierInvoicesSection(OPTIONS, testDb);

    expect(exec.calls).toHaveLength(6);
    expect(result.totals).toEqual({ count: 3, total: 1000, outstanding: 250, paidAmount: 750 });
    expect(result.aging).toEqual([{ bucket: '31-60', count: 1, outstanding: 250 }]);
    expect(result.topInvoicesByOutstanding[0]).toMatchObject({
      id: 'si-1',
      supplierName: 'Vendor',
      outstanding: 250,
    });
    expect(result.topSuppliersByOutstanding).toEqual([
      { label: 'Vendor', value: 250, invoiceCount: 1 },
    ]);
  });
});

describe('getResalesSection', () => {
  test('maps margin, release progress, overdue activity, and category/frequency breakdowns', async () => {
    exec.enqueue({
      rows: [
        {
          count: '2',
          activity_count: '4',
          released_count: '1',
          overdue_count: '2',
          cost: '600',
          revenue: '1000',
        },
      ],
    });
    exec.enqueue({
      rows: [{ label: 'monthly', activity_count: '3', cost: '400', revenue: '750' }],
    });
    exec.enqueue({
      rows: [{ label: 'Licenses', activity_count: '2', cost: '300', revenue: '500' }],
    });
    exec.enqueue({
      rows: [
        {
          id: 'rv-1',
          client_order_id: 'co-1',
          client_name: 'Acme',
          supplier_order_id: 'so-1',
          supplier_name: 'Vendor',
          activity_count: '2',
          cost: '300',
          revenue: '500',
          margin: '200',
        },
      ],
    });

    const result = await repo.getResalesSection(OPTIONS, testDb);

    expect(exec.calls).toHaveLength(4);
    expect(result.totals).toEqual({
      count: 2,
      activityCount: 4,
      releasedActivityCount: 1,
      overdueActivityCount: 2,
      cost: 600,
      revenue: 1000,
      margin: 400,
    });
    expect(result.byBillingFrequency[0]).toMatchObject({ label: 'monthly', margin: 350 });
    expect(result.byCategory[0]).toMatchObject({ label: 'Licenses', margin: 200 });
    expect(result.topResalesByMargin[0]).toMatchObject({
      id: 'rv-1',
      clientName: 'Acme',
      supplierName: 'Vendor',
      margin: 200,
    });
  });

  test('rounds derived margins to currency precision', async () => {
    exec.enqueue({
      rows: [
        {
          count: '1',
          activity_count: '1',
          released_count: '0',
          overdue_count: '0',
          cost: '0.2',
          revenue: '0.3',
        },
      ],
    });
    exec.enqueue({
      rows: [{ label: 'monthly', activity_count: '1', cost: '0.2', revenue: '0.3' }],
    });
    exec.enqueue({
      rows: [{ label: 'Licenses', activity_count: '1', cost: '0.2', revenue: '0.3' }],
    });
    exec.enqueue({ rows: [] });

    const result = await repo.getResalesSection(OPTIONS, testDb);

    expect(result.totals.margin).toBe(0.1);
    expect(result.byBillingFrequency[0]?.margin).toBe(0.1);
    expect(result.byCategory[0]?.margin).toBe(0.1);
  });
});
