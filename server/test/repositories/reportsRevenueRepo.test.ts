import { beforeEach, describe, expect, test } from 'bun:test';
import * as repo from '../../repositories/reportsRevenueRepo.ts';
import { type FakeExecutor, makeFakeExecutor } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;

beforeEach(() => {
  exec = makeFakeExecutor();
});

const FROM = '2026-01-01';
const TO = '2026-01-31';

const enqueueEmptyN = (n: number) => {
  for (let i = 0; i < n; i++) exec.enqueue({ rows: [] });
};

describe('getQuotesSection', () => {
  test('dispatches 5 parallel queries, each scoped to [fromDate, toDate, ...]', async () => {
    enqueueEmptyN(5);
    await repo.getQuotesSection({ fromDate: FROM, toDate: TO, topLimit: 10 }, exec);
    expect(exec.calls).toHaveLength(5);
    for (const call of exec.calls) {
      expect(call.params[0]).toBe(FROM);
      expect(call.params[1]).toBe(TO);
    }
  });

  test('parameterizes LIMIT (no string interpolation)', async () => {
    enqueueEmptyN(5);
    await repo.getQuotesSection({ fromDate: FROM, toDate: TO, topLimit: 25 }, exec);
    const limited = exec.calls.filter((c) => /LIMIT \$\d+/.test(c.sql));
    expect(limited.length).toBeGreaterThan(0);
    for (const call of limited) {
      expect(call.params).toContain(25);
    }
  });

  test('maps totals/byMonth/byStatus/topQuotes/topClients into typed shape', async () => {
    exec.enqueue({ rows: [{ count: '3', total_net: '600', avg_net: '200' }] });
    exec.enqueue({ rows: [{ status: 'won', count: '2', total_net: '400' }] });
    exec.enqueue({ rows: [{ label: '2026-01', count: '3', total_net: '600' }] });
    exec.enqueue({
      rows: [
        {
          id: 'q1',
          client_name: 'Acme',
          status: 'won',
          net_value: '300',
          created_at: '1700000000000',
        },
      ],
    });
    exec.enqueue({ rows: [{ label: 'Acme', quote_count: '2', value: '500' }] });

    const result = await repo.getQuotesSection({ fromDate: FROM, toDate: TO, topLimit: 10 }, exec);

    expect(result.totals).toEqual({ count: 3, totalNet: 600, avgNet: 200 });
    expect(result.byStatus).toEqual([{ status: 'won', count: 2, totalNet: 400 }]);
    expect(result.byMonth).toEqual([{ label: '2026-01', count: 3, totalNet: 600 }]);
    expect(result.topQuotesByNet).toEqual([
      {
        id: 'q1',
        quoteCode: 'q1',
        clientName: 'Acme',
        status: 'won',
        netValue: 300,
        createdAt: 1700000000000,
      },
    ]);
    expect(result.topClientsByNet).toEqual([{ label: 'Acme', value: 500, quoteCount: 2 }]);
  });
});

describe('getOrdersSection', () => {
  test('dispatches 5 parallel queries on sales/sale_items', async () => {
    enqueueEmptyN(5);
    await repo.getOrdersSection({ fromDate: FROM, toDate: TO, topLimit: 10 }, exec);
    expect(exec.calls).toHaveLength(5);
    for (const call of exec.calls) {
      expect(call.sql).toContain('FROM sales s');
    }
  });

  test('maps order rows including createdAt epoch', async () => {
    exec.enqueue({ rows: [{ count: '2', total_net: '900', avg_net: '450' }] });
    exec.enqueue({ rows: [] });
    exec.enqueue({ rows: [] });
    exec.enqueue({
      rows: [
        {
          id: 'o1',
          client_name: 'Acme',
          status: 'shipped',
          net_value: '900',
          created_at: '1700000000000',
        },
      ],
    });
    exec.enqueue({ rows: [{ label: 'Acme', order_count: '2', value: '900' }] });

    const result = await repo.getOrdersSection({ fromDate: FROM, toDate: TO, topLimit: 10 }, exec);
    expect(result.totals.count).toBe(2);
    expect(result.topOrdersByNet).toEqual([
      {
        id: 'o1',
        clientName: 'Acme',
        status: 'shipped',
        netValue: 900,
        createdAt: 1700000000000,
      },
    ]);
    expect(result.topClientsByNet).toEqual([{ label: 'Acme', value: 900, orderCount: 2 }]);
  });
});

describe('getInvoicesSection', () => {
  test('dispatches 6 parallel queries on invoices', async () => {
    enqueueEmptyN(6);
    await repo.getInvoicesSection({ fromDate: FROM, toDate: TO, topLimit: 10 }, exec);
    expect(exec.calls).toHaveLength(6);
    for (const call of exec.calls) {
      expect(call.sql).toContain('FROM invoices');
    }
  });

  test('aging buckets and outstanding values are mapped', async () => {
    exec.enqueue({
      rows: [{ count: '4', total_sum: '1000', outstanding_sum: '300', paid_sum: '700' }],
    });
    exec.enqueue({
      rows: [{ status: 'paid', count: '3', total_sum: '700', outstanding_sum: '0' }],
    });
    exec.enqueue({
      rows: [
        {
          label: '2026-01',
          count: '4',
          total_sum: '1000',
          outstanding_sum: '300',
        },
      ],
    });
    exec.enqueue({ rows: [{ bucket: '0-30', count: '1', outstanding_sum: '300' }] });
    exec.enqueue({
      rows: [
        {
          id: 'i1',
          client_name: 'Acme',
          status: 'overdue',
          due_date: '2026-01-15',
          outstanding: '300',
        },
      ],
    });
    exec.enqueue({ rows: [{ label: 'Acme', invoice_count: '1', value: '300' }] });

    const result = await repo.getInvoicesSection(
      { fromDate: FROM, toDate: TO, topLimit: 10 },
      exec,
    );
    expect(result.totals).toEqual({ count: 4, total: 1000, outstanding: 300, paidAmount: 700 });
    expect(result.aging).toEqual([{ bucket: '0-30', count: 1, outstanding: 300 }]);
    expect(result.topInvoicesByOutstanding).toEqual([
      {
        id: 'i1',
        invoiceNumber: 'i1',
        clientName: 'Acme',
        status: 'overdue',
        dueDate: '2026-01-15',
        outstanding: 300,
      },
    ]);
    expect(result.topClientsByOutstanding).toEqual([
      { label: 'Acme', value: 300, invoiceCount: 1 },
    ]);
  });
});
