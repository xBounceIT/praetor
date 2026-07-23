import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as repo from '../../repositories/reportsClientsRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

const FROM = '2026-01-01';
const TO = '2026-01-31';
const baseOpts = {
  viewerId: 'u1',
  fromDate: FROM,
  toDate: TO,
  canViewAllClients: true,
  canViewClientDetails: true,
  canViewOffers: false,
  canViewQuotes: false,
  canViewOrders: false,
  canViewInvoices: false,
  canViewTimesheets: false,
  canViewAllTimesheets: false,
  allowedTimesheetUserIds: null,
  itemsLimit: 50,
};

describe('getClientsSection', () => {
  test('admin viewer: count + list run in parallel; no activity queries when permissions disabled', async () => {
    exec.enqueueEmptyN(2);
    exec.enqueue({ rows: [{ count: '0' }] });
    await repo.getClientsSection({ ...baseOpts }, testDb);
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls[0].sql).toContain('SELECT COUNT(*)');
    expect(exec.calls[1].sql).not.toContain('user_clients');
  });

  test('non-admin viewer joins user_clients with viewerId', async () => {
    exec.enqueueEmptyN(2);
    await repo.getClientsSection({ ...baseOpts, canViewAllClients: false }, testDb);
    expect(exec.calls[0].sql).toContain('JOIN user_clients');
    expect(exec.calls[0].params).toEqual(['u1']);
    expect(exec.calls[1].params).toEqual(['u1', 50]);
  });

  test('client list maps row shape with toDbText/Boolean coercion', async () => {
    exec.enqueue({ rows: [{ count: '1' }] });
    exec.enqueue({
      rows: [
        {
          id: 'c1',
          name: 'Acme',
          client_code: 'AC',
          type: 'company',
          contact_name: 'Jane',
          email: 'j@a.co',
          phone: '+1',
          address: '1 St',
          is_disabled: false,
        },
      ],
    });
    const result = await repo.getClientsSection({ ...baseOpts }, testDb);
    expect(result.count).toBe(1);
    expect(result.items).toEqual([
      {
        id: 'c1',
        name: 'Acme',
        clientCode: 'AC',
        type: 'company',
        contactName: 'Jane',
        email: 'j@a.co',
        phone: '+1',
        address: '1 St',
        isDisabled: false,
      },
    ]);
  });

  test('omits client contact details without crm.clients.view', async () => {
    exec.enqueue({ rows: [{ count: '1' }] });
    exec.enqueue({
      rows: [
        {
          id: 'c1',
          name: 'Acme',
          client_code: 'AC',
          type: 'company',
          contact_name: 'Jane',
          email: 'j@a.co',
          phone: '+1',
          address: '1 St',
          is_disabled: false,
        },
      ],
    });

    const result = await repo.getClientsSection(
      { ...baseOpts, canViewClientDetails: false },
      testDb,
    );

    expect(exec.calls[1].sql).not.toContain('c.contact_name');
    expect(exec.calls[1].sql).not.toContain('c.email');
    expect(exec.calls[1].sql).not.toContain('c.phone');
    expect(exec.calls[1].sql).not.toContain('c.address');
    expect(result.items).toEqual([
      {
        id: 'c1',
        name: 'Acme',
        clientCode: 'AC',
        type: 'company',
        isDisabled: false,
      },
    ]);
  });

  test('skips activity branches when client list is empty', async () => {
    exec.enqueue({ rows: [{ count: '0' }] });
    exec.enqueue({ rows: [] });
    await repo.getClientsSection(
      {
        ...baseOpts,
        canViewQuotes: true,
        canViewOrders: true,
        canViewInvoices: true,
        canViewTimesheets: true,
      },
      testDb,
    );
    // only count + list - activity Promise.all is short-circuited because clientIds is empty
    expect(exec.calls).toHaveLength(2);
  });

  test('activity branches fire in parallel only when permission is granted', async () => {
    exec.enqueue({ rows: [{ count: '1' }] });
    exec.enqueue({
      rows: [
        {
          id: 'c1',
          name: 'Acme',
          client_code: null,
          type: null,
          contact_name: null,
          email: null,
          phone: null,
          address: null,
          is_disabled: false,
        },
      ],
    });
    exec.enqueue({ rows: [{ client_id: 'c1', quote_count: '2', net_value: '500' }] });
    // canViewQuotes=true only; orders/invoices/timesheets stay null
    const result = await repo.getClientsSection({ ...baseOpts, canViewQuotes: true }, testDb);
    expect(exec.calls).toHaveLength(3);
    expect(result.activitySummary).toEqual([
      {
        clientId: 'c1',
        quotesCount: 2,
        quotesNet: 500,
        offersCount: null,
        offersNet: null,
        ordersCount: null,
        ordersNet: null,
        invoicesCount: null,
        invoicesTotal: null,
        invoicesOutstanding: null,
        timesheetHours: null,
      },
    ]);
  });

  test('client offer activity uses duration and both line and header discounts', async () => {
    exec.enqueue({ rows: [{ count: '1' }] });
    exec.enqueue({
      rows: [
        {
          id: 'c1',
          name: 'Acme',
          client_code: null,
          type: null,
          contact_name: null,
          email: null,
          phone: null,
          address: null,
          is_disabled: false,
        },
      ],
    });
    exec.enqueue({ rows: [{ client_id: 'c1', offer_count: '2', net_value: '840' }] });

    const result = await repo.getClientsSection({ ...baseOpts, canViewOffers: true }, testDb);

    expect(exec.calls).toHaveLength(3);
    const sqlText = exec.calls[2].sql;
    expect(sqlText).toContain('FROM customer_offers co');
    expect(sqlText).toContain('COALESCE(coi.duration_months, 1)');
    expect(sqlText).toContain("coi.duration_unit = 'na'");
    expect(sqlText).toContain("co.discount_type = 'currency'");
    expect(result.activitySummary[0]).toMatchObject({
      clientId: 'c1',
      offersCount: 2,
      offersNet: 840,
    });
  });

  test('orders/invoices/timesheets activity rows are mapped per-client', async () => {
    exec.enqueue({ rows: [{ count: '1' }] });
    exec.enqueue({
      rows: [
        {
          id: 'c1',
          name: 'Acme',
          client_code: null,
          type: null,
          contact_name: null,
          email: null,
          phone: null,
          address: null,
          is_disabled: false,
        },
      ],
    });
    // Activity Promise.all order: quotes, orders, invoices, timesheets.
    // Only orders + invoices + timesheets enabled here, so 3 activity queries.
    exec.enqueue({ rows: [{ client_id: 'c1', order_count: '3', net_value: '750' }] });
    exec.enqueue({
      rows: [
        {
          client_id: 'c1',
          invoice_count: '4',
          total_sum: '1200',
          outstanding_sum: '300',
        },
      ],
    });
    exec.enqueue({ rows: [{ client_id: 'c1', hours: '12' }] });

    const result = await repo.getClientsSection(
      {
        ...baseOpts,
        canViewOrders: true,
        canViewInvoices: true,
        canViewTimesheets: true,
        canViewAllTimesheets: true,
      },
      testDb,
    );
    expect(exec.calls).toHaveLength(5);
    expect(result.activitySummary).toEqual([
      {
        clientId: 'c1',
        quotesCount: null,
        quotesNet: null,
        offersCount: null,
        offersNet: null,
        ordersCount: 3,
        ordersNet: 750,
        invoicesCount: 4,
        invoicesTotal: 1200,
        invoicesOutstanding: 300,
        timesheetHours: 12,
      },
    ]);
  });

  test('activity rows for unknown client_ids are silently ignored', async () => {
    exec.enqueue({ rows: [{ count: '1' }] });
    exec.enqueue({
      rows: [
        {
          id: 'c1',
          name: 'Acme',
          client_code: null,
          type: null,
          contact_name: null,
          email: null,
          phone: null,
          address: null,
          is_disabled: false,
        },
      ],
    });
    // Quote/order/invoice/timesheet rows reference an unknown client; map.get(...) returns
    // undefined, the `if (!target) continue` skips them, and the existing entry stays unchanged.
    exec.enqueue({ rows: [{ client_id: 'unknown', quote_count: '99', net_value: '999' }] });
    exec.enqueue({ rows: [{ client_id: 'unknown', order_count: '5', net_value: '5' }] });
    exec.enqueue({
      rows: [
        {
          client_id: 'unknown',
          invoice_count: '5',
          total_sum: '5',
          outstanding_sum: '5',
        },
      ],
    });
    exec.enqueue({ rows: [{ client_id: 'unknown', hours: '99' }] });

    const result = await repo.getClientsSection(
      {
        ...baseOpts,
        canViewQuotes: true,
        canViewOrders: true,
        canViewInvoices: true,
        canViewTimesheets: true,
        canViewAllTimesheets: true,
      },
      testDb,
    );
    expect(result.activitySummary[0]).toEqual({
      clientId: 'c1',
      quotesCount: null,
      quotesNet: null,
      offersCount: null,
      offersNet: null,
      ordersCount: null,
      ordersNet: null,
      invoicesCount: null,
      invoicesTotal: null,
      invoicesOutstanding: null,
      timesheetHours: null,
    });
  });

  test('timesheet activity respects canViewAllTimesheets scoping', async () => {
    exec.enqueue({ rows: [{ count: '1' }] });
    exec.enqueue({
      rows: [
        {
          id: 'c1',
          name: 'Acme',
          client_code: null,
          type: null,
          contact_name: null,
          email: null,
          phone: null,
          address: null,
          is_disabled: false,
        },
      ],
    });
    exec.enqueue({ rows: [] });
    await repo.getClientsSection(
      {
        ...baseOpts,
        canViewTimesheets: true,
        canViewAllTimesheets: false,
        allowedTimesheetUserIds: ['u1', 'u2'],
      },
      testDb,
    );
    const tsCall = exec.calls.find((c) => c.sql.includes('time_entries'));
    expect(tsCall?.params).toEqual([FROM, TO, ['u1', 'u2'], ['c1']]);
  });
});
