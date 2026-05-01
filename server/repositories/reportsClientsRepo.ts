import pool, { type QueryExecutor } from '../db/index.ts';
import { toDbNumber as toNumber, toDbText as toText } from '../utils/parse.ts';

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
  exec: QueryExecutor = pool,
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
    ? exec.query<{ count: string }>(`SELECT COUNT(*) as count FROM clients`)
    : exec.query<{ count: string }>(
        `SELECT COUNT(*) as count
           FROM clients c
           JOIN user_clients uc ON uc.client_id = c.id
          WHERE uc.user_id = $1`,
        [viewerId],
      );

  const listQuery = canViewAllClients
    ? exec.query<ClientRow>(
        `SELECT
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
          LIMIT $1`,
        [itemsLimit],
      )
    : exec.query<ClientRow>(
        `SELECT DISTINCT
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
          WHERE uc.user_id = $1
          ORDER BY c.name ASC
          LIMIT $2`,
        [viewerId, itemsLimit],
      );

  const [countRes, listRes] = await Promise.all([countQuery, listQuery]);

  const items: ClientInfo[] = listRes.rows.map((r) => ({
    id: toText(r.id),
    name: toText(r.name),
    clientCode: toText(r.client_code),
    type: toText(r.type),
    contactName: toText(r.contact_name),
    email: toText(r.email),
    phone: toText(r.phone),
    address: toText(r.address),
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
      ? exec.query<{ client_id: string; quote_count: string; net_value: string }>(
          `WITH per_quote AS (
                SELECT
                  q.id,
                  q.client_id,
                  SUM(qi.quantity * qi.unit_price * (1 - COALESCE(qi.discount, 0) / 100.0))
                    * (1 - COALESCE(q.discount, 0) / 100.0) as net_value
                FROM quotes q
                JOIN quote_items qi ON qi.quote_id = q.id
               WHERE q.created_at::date >= $1
                 AND q.created_at::date <= $2
                 AND q.client_id = ANY($3)
               GROUP BY q.id
             )
             SELECT
               client_id,
               COUNT(*) as quote_count,
               COALESCE(SUM(net_value), 0) as net_value
               FROM per_quote
               GROUP BY client_id`,
          [fromDate, toDate, clientIds],
        )
      : null;

    const ordersPromise = canViewOrders
      ? exec.query<{ client_id: string; order_count: string; net_value: string }>(
          `WITH per_order AS (
                SELECT
                  s.id,
                  s.client_id,
                  SUM(si.quantity * si.unit_price * (1 - COALESCE(si.discount, 0) / 100.0))
                    * (1 - COALESCE(s.discount, 0) / 100.0) as net_value
                FROM sales s
                JOIN sale_items si ON si.sale_id = s.id
               WHERE s.created_at::date >= $1
                 AND s.created_at::date <= $2
                 AND s.client_id = ANY($3)
               GROUP BY s.id
             )
             SELECT
               client_id,
               COUNT(*) as order_count,
               COALESCE(SUM(net_value), 0) as net_value
               FROM per_order
               GROUP BY client_id`,
          [fromDate, toDate, clientIds],
        )
      : null;

    const invoicesPromise = canViewInvoices
      ? exec.query<{
          client_id: string;
          invoice_count: string;
          total_sum: string;
          outstanding_sum: string;
        }>(
          `SELECT
                client_id,
                COUNT(*) as invoice_count,
                COALESCE(SUM(total), 0) as total_sum,
                COALESCE(SUM(GREATEST(total - amount_paid, 0)), 0) as outstanding_sum
               FROM invoices
              WHERE issue_date >= $1
                AND issue_date <= $2
                AND client_id = ANY($3)
              GROUP BY client_id`,
          [fromDate, toDate, clientIds],
        )
      : null;

    const timesheetsPromise = canViewTimesheets
      ? canViewAllTimesheets
        ? exec.query<{ client_id: string; hours: string }>(
            `SELECT
                te.client_id,
                COALESCE(SUM(te.duration), 0) as hours
               FROM time_entries te
              WHERE te.date >= $1
                AND te.date <= $2
                AND te.client_id = ANY($3)
              GROUP BY te.client_id`,
            [fromDate, toDate, clientIds],
          )
        : exec.query<{ client_id: string; hours: string }>(
            `SELECT
                te.client_id,
                COALESCE(SUM(te.duration), 0) as hours
               FROM time_entries te
              WHERE te.date >= $1
                AND te.date <= $2
                AND te.user_id = ANY($3)
                AND te.client_id = ANY($4)
              GROUP BY te.client_id`,
            [fromDate, toDate, allowedTimesheetUserIds || [], clientIds],
          )
      : null;

    const [quotesRes, ordersRes, invoicesRes, timesheetsRes] = await Promise.all([
      quotesPromise,
      ordersPromise,
      invoicesPromise,
      timesheetsPromise,
    ]);

    if (quotesRes) {
      for (const row of quotesRes.rows) {
        const target = activityByClient.get(toText(row.client_id));
        if (!target) continue;
        target.quotesCount = toNumber(row.quote_count);
        target.quotesNet = toNumber(row.net_value);
      }
    }
    if (ordersRes) {
      for (const row of ordersRes.rows) {
        const target = activityByClient.get(toText(row.client_id));
        if (!target) continue;
        target.ordersCount = toNumber(row.order_count);
        target.ordersNet = toNumber(row.net_value);
      }
    }
    if (invoicesRes) {
      for (const row of invoicesRes.rows) {
        const target = activityByClient.get(toText(row.client_id));
        if (!target) continue;
        target.invoicesCount = toNumber(row.invoice_count);
        target.invoicesTotal = toNumber(row.total_sum);
        target.invoicesOutstanding = toNumber(row.outstanding_sum);
      }
    }
    if (timesheetsRes) {
      for (const row of timesheetsRes.rows) {
        const target = activityByClient.get(toText(row.client_id));
        if (!target) continue;
        target.timesheetHours = toNumber(row.hours);
      }
    }
  }

  return {
    count: toNumber(countRes.rows[0]?.count),
    items,
    activitySummary: clientIds
      .map((id) => activityByClient.get(id))
      .filter((a): a is ClientActivity => a !== undefined),
  };
};
