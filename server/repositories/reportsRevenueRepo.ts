import { sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { toDbNumber, toDbText } from '../utils/parse.ts';

export type RevenueDateRangeOptions = {
  fromDate: string;
  toDate: string;
  topLimit: number;
};

export type QuotesSection = {
  totals: { count: number; totalNet: number; avgNet: number };
  byMonth: Array<{ label: string; count: number; totalNet: number }>;
  byStatus: Array<{ status: string; count: number; totalNet: number }>;
  topQuotesByNet: Array<{
    id: string;
    quoteCode: string;
    clientName: string;
    status: string;
    netValue: number;
    createdAt: number;
  }>;
  topClientsByNet: Array<{ label: string; value: number; quoteCount: number }>;
};

export const getQuotesSection = async (
  opts: RevenueDateRangeOptions,
  exec: DbExecutor = db,
): Promise<QuotesSection> => {
  const { fromDate, toDate, topLimit } = opts;

  const [totals, byStatus, byMonth, topQuotes, topClients] = await Promise.all([
    executeRows<{ count: string; total_net: string; avg_net: string }>(
      exec,
      sql`WITH per_quote AS (
          SELECT
            q.id,
            SUM(qi.quantity * qi.unit_price * (1 - COALESCE(qi.discount, 0) / 100.0))
              * (1 - COALESCE(q.discount, 0) / 100.0) as net_value
            FROM quotes q
            JOIN quote_items qi ON qi.quote_id = q.id
           WHERE q.created_at::date >= ${fromDate} AND q.created_at::date <= ${toDate}
           GROUP BY q.id
         )
        SELECT
          COUNT(*) as count,
          COALESCE(SUM(net_value), 0) as total_net,
          COALESCE(AVG(net_value), 0) as avg_net
          FROM per_quote`,
    ),
    executeRows<{ status: string; count: string; total_net: string }>(
      exec,
      sql`WITH per_quote AS (
          SELECT
            q.id,
            q.status,
            q.client_name,
            q.created_at,
            (SUM(qi.quantity * qi.unit_price * (1 - COALESCE(qi.discount, 0) / 100.0)) * (1 - COALESCE(q.discount, 0) / 100.0)) as net_value
            FROM quotes q
            JOIN quote_items qi ON qi.quote_id = q.id
           WHERE q.created_at::date >= ${fromDate} AND q.created_at::date <= ${toDate}
           GROUP BY q.id
         )
        SELECT status, COUNT(*) as count, COALESCE(SUM(net_value), 0) as total_net
          FROM per_quote
         GROUP BY status
         ORDER BY count DESC`,
    ),
    executeRows<{ label: string; count: string; total_net: string }>(
      exec,
      sql`WITH per_quote AS (
          SELECT
            q.id,
            q.created_at,
            SUM(qi.quantity * qi.unit_price * (1 - COALESCE(qi.discount, 0) / 100.0))
              * (1 - COALESCE(q.discount, 0) / 100.0) as net_value
            FROM quotes q
            JOIN quote_items qi ON qi.quote_id = q.id
           WHERE q.created_at::date >= ${fromDate} AND q.created_at::date <= ${toDate}
           GROUP BY q.id
         )
        SELECT
          TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') as label,
          COUNT(*) as count,
          COALESCE(SUM(net_value), 0) as total_net
          FROM per_quote
         GROUP BY DATE_TRUNC('month', created_at)
         ORDER BY label ASC`,
    ),
    executeRows<{
      id: string;
      client_name: string;
      status: string;
      net_value: string;
      created_at: string;
    }>(
      exec,
      sql`WITH per_quote AS (
          SELECT
            q.id,
            q.client_name,
            q.status,
            q.created_at,
            SUM(qi.quantity * qi.unit_price * (1 - COALESCE(qi.discount, 0) / 100.0))
              * (1 - COALESCE(q.discount, 0) / 100.0) as net_value
            FROM quotes q
            JOIN quote_items qi ON qi.quote_id = q.id
           WHERE q.created_at::date >= ${fromDate} AND q.created_at::date <= ${toDate}
           GROUP BY q.id
         )
        SELECT
          id,
          client_name,
          status,
          net_value,
          EXTRACT(EPOCH FROM created_at) * 1000 as created_at
          FROM per_quote
         ORDER BY net_value DESC
         LIMIT ${topLimit}`,
    ),
    executeRows<{ label: string; quote_count: string; value: string }>(
      exec,
      sql`WITH per_quote AS (
          SELECT
            q.id,
            q.client_name,
            (SUM(qi.quantity * qi.unit_price * (1 - COALESCE(qi.discount, 0) / 100.0)) * (1 - COALESCE(q.discount, 0) / 100.0)) as net_value
            FROM quotes q
            JOIN quote_items qi ON qi.quote_id = q.id
           WHERE q.created_at::date >= ${fromDate} AND q.created_at::date <= ${toDate}
           GROUP BY q.id
         )
        SELECT
          client_name as label,
          COUNT(*) as quote_count,
          COALESCE(SUM(net_value), 0) as value
          FROM per_quote
         GROUP BY client_name
         ORDER BY value DESC
         LIMIT ${topLimit}`,
    ),
  ]);

  return {
    totals: {
      count: toDbNumber(totals[0]?.count),
      totalNet: toDbNumber(totals[0]?.total_net),
      avgNet: toDbNumber(totals[0]?.avg_net),
    },
    byMonth: byMonth.map((r) => ({
      label: toDbText(r.label),
      count: toDbNumber(r.count),
      totalNet: toDbNumber(r.total_net),
    })),
    byStatus: byStatus.map((r) => ({
      status: toDbText(r.status),
      count: toDbNumber(r.count),
      totalNet: toDbNumber(r.total_net),
    })),
    topQuotesByNet: topQuotes.map((r) => {
      const id = toDbText(r.id);
      return {
        id,
        quoteCode: id,
        clientName: toDbText(r.client_name),
        status: toDbText(r.status),
        netValue: toDbNumber(r.net_value),
        createdAt: toDbNumber(r.created_at),
      };
    }),
    topClientsByNet: topClients.map((r) => ({
      label: toDbText(r.label),
      value: toDbNumber(r.value),
      quoteCount: toDbNumber(r.quote_count),
    })),
  };
};

export type OrdersSection = {
  totals: { count: number; totalNet: number; avgNet: number };
  byMonth: Array<{ label: string; count: number; totalNet: number }>;
  byStatus: Array<{ status: string; count: number; totalNet: number }>;
  topOrdersByNet: Array<{
    id: string;
    clientName: string;
    status: string;
    netValue: number;
    createdAt: number;
  }>;
  topClientsByNet: Array<{ label: string; value: number; orderCount: number }>;
};

export const getOrdersSection = async (
  opts: RevenueDateRangeOptions,
  exec: DbExecutor = db,
): Promise<OrdersSection> => {
  const { fromDate, toDate, topLimit } = opts;

  const [totals, byStatus, byMonth, topOrders, topClients] = await Promise.all([
    executeRows<{ count: string; total_net: string; avg_net: string }>(
      exec,
      sql`WITH per_order AS (
          SELECT
            s.id,
            SUM(si.quantity * si.unit_price * (1 - COALESCE(si.discount, 0) / 100.0))
              * (1 - COALESCE(s.discount, 0) / 100.0) as net_value
            FROM sales s
            JOIN sale_items si ON si.sale_id = s.id
           WHERE s.created_at::date >= ${fromDate} AND s.created_at::date <= ${toDate}
           GROUP BY s.id
         )
        SELECT
          COUNT(*) as count,
          COALESCE(SUM(net_value), 0) as total_net,
          COALESCE(AVG(net_value), 0) as avg_net
          FROM per_order`,
    ),
    executeRows<{ status: string; count: string; total_net: string }>(
      exec,
      sql`WITH per_order AS (
          SELECT
            s.id,
            s.status,
            s.client_name,
            s.created_at,
            (SUM(si.quantity * si.unit_price * (1 - COALESCE(si.discount, 0) / 100.0)) * (1 - COALESCE(s.discount, 0) / 100.0)) as net_value
            FROM sales s
            JOIN sale_items si ON si.sale_id = s.id
           WHERE s.created_at::date >= ${fromDate} AND s.created_at::date <= ${toDate}
           GROUP BY s.id
         )
        SELECT status, COUNT(*) as count, COALESCE(SUM(net_value), 0) as total_net
          FROM per_order
         GROUP BY status
         ORDER BY count DESC`,
    ),
    executeRows<{ label: string; count: string; total_net: string }>(
      exec,
      sql`WITH per_order AS (
          SELECT
            s.id,
            s.created_at,
            SUM(si.quantity * si.unit_price * (1 - COALESCE(si.discount, 0) / 100.0))
              * (1 - COALESCE(s.discount, 0) / 100.0) as net_value
            FROM sales s
            JOIN sale_items si ON si.sale_id = s.id
           WHERE s.created_at::date >= ${fromDate} AND s.created_at::date <= ${toDate}
           GROUP BY s.id
         )
        SELECT
          TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') as label,
          COUNT(*) as count,
          COALESCE(SUM(net_value), 0) as total_net
          FROM per_order
         GROUP BY DATE_TRUNC('month', created_at)
         ORDER BY label ASC`,
    ),
    executeRows<{
      id: string;
      client_name: string;
      status: string;
      net_value: string;
      created_at: string;
    }>(
      exec,
      sql`WITH per_order AS (
          SELECT
            s.id,
            s.client_name,
            s.status,
            s.created_at,
            SUM(si.quantity * si.unit_price * (1 - COALESCE(si.discount, 0) / 100.0))
              * (1 - COALESCE(s.discount, 0) / 100.0) as net_value
            FROM sales s
            JOIN sale_items si ON si.sale_id = s.id
           WHERE s.created_at::date >= ${fromDate} AND s.created_at::date <= ${toDate}
           GROUP BY s.id
         )
        SELECT
          id,
          client_name,
          status,
          net_value,
          EXTRACT(EPOCH FROM created_at) * 1000 as created_at
          FROM per_order
         ORDER BY net_value DESC
         LIMIT ${topLimit}`,
    ),
    executeRows<{ label: string; order_count: string; value: string }>(
      exec,
      sql`WITH per_order AS (
          SELECT
            s.id,
            s.client_name,
            (SUM(si.quantity * si.unit_price * (1 - COALESCE(si.discount, 0) / 100.0)) * (1 - COALESCE(s.discount, 0) / 100.0)) as net_value
            FROM sales s
            JOIN sale_items si ON si.sale_id = s.id
           WHERE s.created_at::date >= ${fromDate} AND s.created_at::date <= ${toDate}
           GROUP BY s.id
         )
        SELECT
          client_name as label,
          COUNT(*) as order_count,
          COALESCE(SUM(net_value), 0) as value
          FROM per_order
         GROUP BY client_name
         ORDER BY value DESC
         LIMIT ${topLimit}`,
    ),
  ]);

  return {
    totals: {
      count: toDbNumber(totals[0]?.count),
      totalNet: toDbNumber(totals[0]?.total_net),
      avgNet: toDbNumber(totals[0]?.avg_net),
    },
    byMonth: byMonth.map((r) => ({
      label: toDbText(r.label),
      count: toDbNumber(r.count),
      totalNet: toDbNumber(r.total_net),
    })),
    byStatus: byStatus.map((r) => ({
      status: toDbText(r.status),
      count: toDbNumber(r.count),
      totalNet: toDbNumber(r.total_net),
    })),
    topOrdersByNet: topOrders.map((r) => ({
      id: toDbText(r.id),
      clientName: toDbText(r.client_name),
      status: toDbText(r.status),
      netValue: toDbNumber(r.net_value),
      createdAt: toDbNumber(r.created_at),
    })),
    topClientsByNet: topClients.map((r) => ({
      label: toDbText(r.label),
      value: toDbNumber(r.value),
      orderCount: toDbNumber(r.order_count),
    })),
  };
};

export type InvoicesSection = {
  totals: { count: number; total: number; outstanding: number; paidAmount: number };
  byMonth: Array<{ label: string; count: number; total: number; outstanding: number }>;
  aging: Array<{ bucket: string; count: number; outstanding: number }>;
  byStatus: Array<{ status: string; count: number; total: number; outstanding: number }>;
  topInvoicesByOutstanding: Array<{
    id: string;
    invoiceNumber: string;
    clientName: string;
    status: string;
    dueDate: string;
    outstanding: number;
  }>;
  topClientsByOutstanding: Array<{ label: string; value: number; invoiceCount: number }>;
};

export const getInvoicesSection = async (
  opts: RevenueDateRangeOptions,
  exec: DbExecutor = db,
): Promise<InvoicesSection> => {
  const { fromDate, toDate, topLimit } = opts;

  const [totals, byStatus, byMonth, aging, topInvoices, topClients] = await Promise.all([
    executeRows<{
      count: string;
      total_sum: string;
      outstanding_sum: string;
      paid_sum: string;
    }>(
      exec,
      sql`SELECT
          COUNT(*) as count,
          COALESCE(SUM(total), 0) as total_sum,
          COALESCE(SUM(GREATEST(total - amount_paid, 0)), 0) as outstanding_sum,
          COALESCE(SUM(amount_paid), 0) as paid_sum
         FROM invoices
        WHERE issue_date >= ${fromDate} AND issue_date <= ${toDate}`,
    ),
    executeRows<{
      status: string;
      count: string;
      total_sum: string;
      outstanding_sum: string;
    }>(
      exec,
      sql`SELECT status,
              COUNT(*) as count,
              COALESCE(SUM(total), 0) as total_sum,
              COALESCE(SUM(GREATEST(total - amount_paid, 0)), 0) as outstanding_sum
         FROM invoices
        WHERE issue_date >= ${fromDate} AND issue_date <= ${toDate}
        GROUP BY status
        ORDER BY count DESC`,
    ),
    executeRows<{
      label: string;
      count: string;
      total_sum: string;
      outstanding_sum: string;
    }>(
      exec,
      sql`SELECT
          TO_CHAR(DATE_TRUNC('month', issue_date), 'YYYY-MM') as label,
          COUNT(*) as count,
          COALESCE(SUM(total), 0) as total_sum,
          COALESCE(SUM(GREATEST(total - amount_paid, 0)), 0) as outstanding_sum
         FROM invoices
        WHERE issue_date >= ${fromDate} AND issue_date <= ${toDate}
        GROUP BY DATE_TRUNC('month', issue_date)
        ORDER BY label ASC`,
    ),
    executeRows<{ bucket: string; count: string; outstanding_sum: string }>(
      exec,
      sql`SELECT
          CASE
            WHEN CURRENT_DATE - due_date <= 30 THEN '0-30'
            WHEN CURRENT_DATE - due_date <= 60 THEN '31-60'
            WHEN CURRENT_DATE - due_date <= 90 THEN '61-90'
            ELSE '90+'
          END as bucket,
          COUNT(*) as count,
          COALESCE(SUM(GREATEST(total - amount_paid, 0)), 0) as outstanding_sum
         FROM invoices
        WHERE issue_date >= ${fromDate}
          AND issue_date <= ${toDate}
          AND GREATEST(total - amount_paid, 0) > 0
        GROUP BY bucket
        ORDER BY bucket ASC`,
    ),
    executeRows<{
      id: string;
      client_name: string;
      status: string;
      due_date: string;
      outstanding: string;
    }>(
      exec,
      sql`SELECT
          id,
          client_name,
          status,
          due_date,
          GREATEST(total - amount_paid, 0) as outstanding
         FROM invoices
        WHERE issue_date >= ${fromDate} AND issue_date <= ${toDate}
        ORDER BY outstanding DESC
        LIMIT ${topLimit}`,
    ),
    executeRows<{ label: string; invoice_count: string; value: string }>(
      exec,
      sql`SELECT
          client_name as label,
          COUNT(*) as invoice_count,
          COALESCE(SUM(GREATEST(total - amount_paid, 0)), 0) as value
         FROM invoices
        WHERE issue_date >= ${fromDate} AND issue_date <= ${toDate}
        GROUP BY client_name
        ORDER BY value DESC
        LIMIT ${topLimit}`,
    ),
  ]);

  return {
    totals: {
      count: toDbNumber(totals[0]?.count),
      total: toDbNumber(totals[0]?.total_sum),
      outstanding: toDbNumber(totals[0]?.outstanding_sum),
      paidAmount: toDbNumber(totals[0]?.paid_sum),
    },
    byMonth: byMonth.map((r) => ({
      label: toDbText(r.label),
      count: toDbNumber(r.count),
      total: toDbNumber(r.total_sum),
      outstanding: toDbNumber(r.outstanding_sum),
    })),
    aging: aging.map((r) => ({
      bucket: toDbText(r.bucket),
      count: toDbNumber(r.count),
      outstanding: toDbNumber(r.outstanding_sum),
    })),
    byStatus: byStatus.map((r) => ({
      status: toDbText(r.status),
      count: toDbNumber(r.count),
      total: toDbNumber(r.total_sum),
      outstanding: toDbNumber(r.outstanding_sum),
    })),
    topInvoicesByOutstanding: topInvoices.map((r) => {
      const id = toDbText(r.id);
      return {
        id,
        invoiceNumber: id,
        clientName: toDbText(r.client_name),
        status: toDbText(r.status),
        dueDate: toDbText(r.due_date),
        outstanding: toDbNumber(r.outstanding),
      };
    }),
    topClientsByOutstanding: topClients.map((r) => ({
      label: toDbText(r.label),
      value: toDbNumber(r.value),
      invoiceCount: toDbNumber(r.invoice_count),
    })),
  };
};
