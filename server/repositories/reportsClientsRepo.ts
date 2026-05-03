import { sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { toDbNumber, toDbText } from '../utils/parse.ts';

type ClientRow = {
  id: string;
  name: string | null;
  client_code: string | null;
  type: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  is_disabled: boolean | null;
};

export type ClientsSectionOptions = {
  viewerId: string;
  fromDate: string;
  toDate: string;
  canViewAllClients: boolean;
  canViewQuotes: boolean;
  canViewOrders: boolean;
  canViewInvoices: boolean;
  canViewTimesheets: boolean;
  canViewAllTimesheets: boolean;
  allowedTimesheetUserIds: string[] | null;
  itemsLimit: number;
};

export type ClientInfo = {
  id: string;
  name: string;
  clientCode: string;
  type: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  isDisabled: boolean;
};

export type ClientActivity = {
  clientId: string;
  quotesCount: number | null;
  quotesNet: number | null;
  ordersCount: number | null;
  ordersNet: number | null;
  invoicesCount: number | null;
  invoicesTotal: number | null;
  invoicesOutstanding: number | null;
  timesheetHours: number | null;
};

export type ClientsSection = {
  count: number;
  items: ClientInfo[];
  activitySummary: ClientActivity[];
};

export const getClientsSection = async (
  opts: ClientsSectionOptions,
  exec: DbExecutor = db,
): Promise<ClientsSection> => {
  const {
    viewerId,
    fromDate,
    toDate,
    canViewAllClients,
    canViewQuotes,
    canViewOrders,
    canViewInvoices,
    canViewTimesheets,
    canViewAllTimesheets,
    allowedTimesheetUserIds,
    itemsLimit,
  } = opts;

  const countQuery = canViewAllClients
    ? executeRows<{ count: string }>(exec, sql`SELECT COUNT(*) as count FROM clients`)
    : executeRows<{ count: string }>(
        exec,
        sql`SELECT COUNT(*) as count
              FROM clients c
              JOIN user_clients uc ON uc.client_id = c.id
             WHERE uc.user_id = ${viewerId}`,
      );

  const listQuery = canViewAllClients
    ? executeRows<ClientRow>(
        exec,
        sql`SELECT
              c.id,
              c.name,
              c.client_code,
              c.type,
              c.contact_name,
              c.email,
              c.phone,
              c.address,
              c.is_disabled
             FROM clients c
            ORDER BY c.name ASC
            LIMIT ${itemsLimit}`,
      )
    : executeRows<ClientRow>(
        exec,
        sql`SELECT DISTINCT
              c.id,
              c.name,
              c.client_code,
              c.type,
              c.contact_name,
              c.email,
              c.phone,
              c.address,
              c.is_disabled
             FROM clients c
             JOIN user_clients uc ON uc.client_id = c.id
            WHERE uc.user_id = ${viewerId}
            ORDER BY c.name ASC
            LIMIT ${itemsLimit}`,
      );

  const [countRows, listRows] = await Promise.all([countQuery, listQuery]);

  const items: ClientInfo[] = listRows.map((r) => ({
    id: toDbText(r.id),
    name: toDbText(r.name),
    clientCode: toDbText(r.client_code),
    type: toDbText(r.type),
    contactName: toDbText(r.contact_name),
    email: toDbText(r.email),
    phone: toDbText(r.phone),
    address: toDbText(r.address),
    isDisabled: Boolean(r.is_disabled),
  }));

  const clientIds = items.map((i) => i.id).filter(Boolean);

  const activityByClient = new Map<string, ClientActivity>();
  for (const clientId of clientIds) {
    activityByClient.set(clientId, {
      clientId,
      quotesCount: null,
      quotesNet: null,
      ordersCount: null,
      ordersNet: null,
      invoicesCount: null,
      invoicesTotal: null,
      invoicesOutstanding: null,
      timesheetHours: null,
    });
  }

  if (clientIds.length > 0) {
    const quotesPromise = canViewQuotes
      ? executeRows<{ client_id: string; quote_count: string; net_value: string }>(
          exec,
          sql`WITH per_quote AS (
                SELECT
                  q.id,
                  q.client_id,
                  SUM(qi.quantity * qi.unit_price * (1 - COALESCE(qi.discount, 0) / 100.0))
                    * (1 - COALESCE(q.discount, 0) / 100.0) as net_value
                FROM quotes q
                JOIN quote_items qi ON qi.quote_id = q.id
               WHERE q.created_at::date >= ${fromDate}
                 AND q.created_at::date <= ${toDate}
                 AND q.client_id = ANY(${sql.param(clientIds)})
               GROUP BY q.id
             )
             SELECT
               client_id,
               COUNT(*) as quote_count,
               COALESCE(SUM(net_value), 0) as net_value
               FROM per_quote
               GROUP BY client_id`,
        )
      : null;

    const ordersPromise = canViewOrders
      ? executeRows<{ client_id: string; order_count: string; net_value: string }>(
          exec,
          sql`WITH per_order AS (
                SELECT
                  s.id,
                  s.client_id,
                  SUM(si.quantity * si.unit_price * (1 - COALESCE(si.discount, 0) / 100.0))
                    * (1 - COALESCE(s.discount, 0) / 100.0) as net_value
                FROM sales s
                JOIN sale_items si ON si.sale_id = s.id
               WHERE s.created_at::date >= ${fromDate}
                 AND s.created_at::date <= ${toDate}
                 AND s.client_id = ANY(${sql.param(clientIds)})
               GROUP BY s.id
             )
             SELECT
               client_id,
               COUNT(*) as order_count,
               COALESCE(SUM(net_value), 0) as net_value
               FROM per_order
               GROUP BY client_id`,
        )
      : null;

    const invoicesPromise = canViewInvoices
      ? executeRows<{
          client_id: string;
          invoice_count: string;
          total_sum: string;
          outstanding_sum: string;
        }>(
          exec,
          sql`SELECT
                client_id,
                COUNT(*) as invoice_count,
                COALESCE(SUM(total), 0) as total_sum,
                COALESCE(SUM(GREATEST(total - amount_paid, 0)), 0) as outstanding_sum
               FROM invoices
              WHERE issue_date >= ${fromDate}
                AND issue_date <= ${toDate}
                AND client_id = ANY(${sql.param(clientIds)})
              GROUP BY client_id`,
        )
      : null;

    const timesheetUserFilter = canViewAllTimesheets
      ? sql``
      : sql`AND te.user_id = ANY(${sql.param(allowedTimesheetUserIds || [])})`;
    const timesheetsPromise = canViewTimesheets
      ? executeRows<{ client_id: string; hours: string }>(
          exec,
          sql`SELECT
              te.client_id,
              COALESCE(SUM(te.duration), 0) as hours
             FROM time_entries te
            WHERE te.date >= ${fromDate}
              AND te.date <= ${toDate}
              ${timesheetUserFilter}
              AND te.client_id = ANY(${sql.param(clientIds)})
            GROUP BY te.client_id`,
        )
      : null;

    const [quotesRows, ordersRows, invoicesRows, timesheetsRows] = await Promise.all([
      quotesPromise,
      ordersPromise,
      invoicesPromise,
      timesheetsPromise,
    ]);

    if (quotesRows) {
      for (const row of quotesRows) {
        const target = activityByClient.get(toDbText(row.client_id));
        if (!target) continue;
        target.quotesCount = toDbNumber(row.quote_count);
        target.quotesNet = toDbNumber(row.net_value);
      }
    }
    if (ordersRows) {
      for (const row of ordersRows) {
        const target = activityByClient.get(toDbText(row.client_id));
        if (!target) continue;
        target.ordersCount = toDbNumber(row.order_count);
        target.ordersNet = toDbNumber(row.net_value);
      }
    }
    if (invoicesRows) {
      for (const row of invoicesRows) {
        const target = activityByClient.get(toDbText(row.client_id));
        if (!target) continue;
        target.invoicesCount = toDbNumber(row.invoice_count);
        target.invoicesTotal = toDbNumber(row.total_sum);
        target.invoicesOutstanding = toDbNumber(row.outstanding_sum);
      }
    }
    if (timesheetsRows) {
      for (const row of timesheetsRows) {
        const target = activityByClient.get(toDbText(row.client_id));
        if (!target) continue;
        target.timesheetHours = toDbNumber(row.hours);
      }
    }
  }

  return {
    count: toDbNumber(countRows[0]?.count),
    items,
    activitySummary: Array.from(activityByClient.values()),
  };
};
