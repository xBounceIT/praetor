import pool, { type QueryExecutor } from '../db/index.ts';
import { toDbNumber as toNumber, toDbText as toText } from '../utils/parse.ts';

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
  exec: QueryExecutor = pool,
): Promise<QuotesSection> => {
  const { fromDate, toDate, topLimit } = opts;

  const [totals, byStatus, byMonth, topQuotes, topClients] = await Promise.all([
    exec.query<{ count: string; total_net: string; avg_net: string }>(
      `WITH per_quote AS (
          SELECT
            q.id,
            SUM(qi.quantity * qi.unit_price * (1 - COALESCE(qi.discount, 0) / 100.0))
              * (1 - COALESCE(q.discount, 0) / 100.0) as net_value
            FROM quotes q
            JOIN quote_items qi ON qi.quote_id = q.id
           WHERE q.created_at::date >= $1 AND q.created_at::date <= $2
           GROUP BY q.id
         )
        SELECT
          COUNT(*) as count,
          COALESCE(SUM(net_value), 0) as total_net,
          COALESCE(AVG(net_value), 0) as avg_net
          FROM per_quote`,
      [fromDate, toDate],
    ),
    exec.query<{ status: string; count: string; total_net: string }>(
      `WITH per_quote AS (
          SELECT
            q.id,
            q.status,
            q.client_name,
            q.created_at,
            (SUM(qi.quantity * qi.unit_price * (1 - COALESCE(qi.discount, 0) / 100.0)) * (1 - COALESCE(q.discount, 0) / 100.0)) as net_value
            FROM quotes q
            JOIN quote_items qi ON qi.quote_id = q.id
           WHERE q.created_at::date >= $1 AND q.created_at::date <= $2
           GROUP BY q.id
         )
        SELECT status, COUNT(*) as count, COALESCE(SUM(net_value), 0) as total_net
          FROM per_quote
         GROUP BY status
         ORDER BY count DESC`,
      [fromDate, toDate],
    ),
    exec.query<{ label: string; count: string; total_net: string }>(
      `WITH per_quote AS (
          SELECT
            q.id,
            q.created_at,
            SUM(qi.quantity * qi.unit_price * (1 - COALESCE(qi.discount, 0) / 100.0))
              * (1 - COALESCE(q.discount, 0) / 100.0) as net_value
            FROM quotes q
            JOIN quote_items qi ON qi.quote_id = q.id
           WHERE q.created_at::date >= $1 AND q.created_at::date <= $2
           GROUP BY q.id
         )
        SELECT
          TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') as label,
          COUNT(*) as count,
          COALESCE(SUM(net_value), 0) as total_net
          FROM per_quote
         GROUP BY DATE_TRUNC('month', created_at)
         ORDER BY label ASC`,
      [fromDate, toDate],
    ),
    exec.query<{
      id: string;
      client_name: string;
      status: string;
      net_value: string;
      created_at: string;
    }>(
      `WITH per_quote AS (
          SELECT
            q.id,
            q.client_name,
            q.status,
            q.created_at,
            SUM(qi.quantity * qi.unit_price * (1 - COALESCE(qi.discount, 0) / 100.0))
              * (1 - COALESCE(q.discount, 0) / 100.0) as net_value
            FROM quotes q
            JOIN quote_items qi ON qi.quote_id = q.id
           WHERE q.created_at::date >= $1 AND q.created_at::date <= $2
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
      [fromDate, toDate],
    ),
    exec.query<{ label: string; quote_count: string; value: string }>(
      `WITH per_quote AS (
          SELECT
            q.id,
            q.client_name,
            (SUM(qi.quantity * qi.unit_price * (1 - COALESCE(qi.discount, 0) / 100.0)) * (1 - COALESCE(q.discount, 0) / 100.0)) as net_value
            FROM quotes q
            JOIN quote_items qi ON qi.quote_id = q.id
           WHERE q.created_at::date >= $1 AND q.created_at::date <= $2
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
      [fromDate, toDate],
    ),
  ]);

  return {
    totals: {
      count: toNumber(totals.rows[0]?.count),
      totalNet: toNumber(totals.rows[0]?.total_net),
      avgNet: toNumber(totals.rows[0]?.avg_net),
    },
    byMonth: byMonth.rows.map((r) => ({
      label: toText(r.label),
      count: toNumber(r.count),
      totalNet: toNumber(r.total_net),
    })),
    byStatus: byStatus.rows.map((r) => ({
      status: toText(r.status),
      count: toNumber(r.count),
      totalNet: toNumber(r.total_net),
    })),
    topQuotesByNet: topQuotes.rows.map((r) => ({
      id: toText(r.id),
      quoteCode: toText(r.id),
      clientName: toText(r.client_name),
      status: toText(r.status),
      netValue: toNumber(r.net_value),
      createdAt: toNumber(r.created_at),
    })),
    topClientsByNet: topClients.rows.map((r) => ({
      label: toText(r.label),
      value: toNumber(r.value),
      quoteCount: toNumber(r.quote_count),
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
  exec: QueryExecutor = pool,
): Promise<OrdersSection> => {
  const { fromDate, toDate, topLimit } = opts;

  const [totals, byStatus, byMonth, topOrders, topClients] = await Promise.all([
    exec.query<{ count: string; total_net: string; avg_net: string }>(
      `WITH per_order AS (
          SELECT
            s.id,
            SUM(si.quantity * si.unit_price * (1 - COALESCE(si.discount, 0) / 100.0))
              * (1 - COALESCE(s.discount, 0) / 100.0) as net_value
            FROM sales s
            JOIN sale_items si ON si.sale_id = s.id
           WHERE s.created_at::date >= $1 AND s.created_at::date <= $2
           GROUP BY s.id
         )
        SELECT
          COUNT(*) as count,
          COALESCE(SUM(net_value), 0) as total_net,
          COALESCE(AVG(net_value), 0) as avg_net
          FROM per_order`,
      [fromDate, toDate],
    ),
    exec.query<{ status: string; count: string; total_net: string }>(
      `WITH per_order AS (
          SELECT
            s.id,
            s.status,
            s.client_name,
            s.created_at,
            (SUM(si.quantity * si.unit_price * (1 - COALESCE(si.discount, 0) / 100.0)) * (1 - COALESCE(s.discount, 0) / 100.0)) as net_value
            FROM sales s
            JOIN sale_items si ON si.sale_id = s.id
           WHERE s.created_at::date >= $1 AND s.created_at::date <= $2
           GROUP BY s.id
         )
        SELECT status, COUNT(*) as count, COALESCE(SUM(net_value), 0) as total_net
          FROM per_order
         GROUP BY status
         ORDER BY count DESC`,
      [fromDate, toDate],
    ),
    exec.query<{ label: string; count: string; total_net: string }>(
      `WITH per_order AS (
          SELECT
            s.id,
            s.created_at,
            SUM(si.quantity * si.unit_price * (1 - COALESCE(si.discount, 0) / 100.0))
              * (1 - COALESCE(s.discount, 0) / 100.0) as net_value
            FROM sales s
            JOIN sale_items si ON si.sale_id = s.id
           WHERE s.created_at::date >= $1 AND s.created_at::date <= $2
           GROUP BY s.id
         )
        SELECT
          TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') as label,
          COUNT(*) as count,
          COALESCE(SUM(net_value), 0) as total_net
          FROM per_order
         GROUP BY DATE_TRUNC('month', created_at)
         ORDER BY label ASC`,
      [fromDate, toDate],
    ),
    exec.query<{
      id: string;
      client_name: string;
      status: string;
      net_value: string;
      created_at: string;
    }>(
      `WITH per_order AS (
          SELECT
            s.id,
            s.client_name,
            s.status,
            s.created_at,
            SUM(si.quantity * si.unit_price * (1 - COALESCE(si.discount, 0) / 100.0))
              * (1 - COALESCE(s.discount, 0) / 100.0) as net_value
            FROM sales s
            JOIN sale_items si ON si.sale_id = s.id
           WHERE s.created_at::date >= $1 AND s.created_at::date <= $2
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
      [fromDate, toDate],
    ),
    exec.query<{ label: string; order_count: string; value: string }>(
      `WITH per_order AS (
          SELECT
            s.id,
            s.client_name,
            (SUM(si.quantity * si.unit_price * (1 - COALESCE(si.discount, 0) / 100.0)) * (1 - COALESCE(s.discount, 0) / 100.0)) as net_value
            FROM sales s
            JOIN sale_items si ON si.sale_id = s.id
           WHERE s.created_at::date >= $1 AND s.created_at::date <= $2
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
      [fromDate, toDate],
    ),
  ]);

  return {
    totals: {
      count: toNumber(totals.rows[0]?.count),
      totalNet: toNumber(totals.rows[0]?.total_net),
      avgNet: toNumber(totals.rows[0]?.avg_net),
    },
    byMonth: byMonth.rows.map((r) => ({
      label: toText(r.label),
      count: toNumber(r.count),
      totalNet: toNumber(r.total_net),
    })),
    byStatus: byStatus.rows.map((r) => ({
      status: toText(r.status),
      count: toNumber(r.count),
      totalNet: toNumber(r.total_net),
    })),
    topOrdersByNet: topOrders.rows.map((r) => ({
      id: toText(r.id),
      clientName: toText(r.client_name),
      status: toText(r.status),
      netValue: toNumber(r.net_value),
      createdAt: toNumber(r.created_at),
    })),
    topClientsByNet: topClients.rows.map((r) => ({
      label: toText(r.label),
      value: toNumber(r.value),
      orderCount: toNumber(r.order_count),
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
  exec: QueryExecutor = pool,
): Promise<InvoicesSection> => {
  const { fromDate, toDate, topLimit } = opts;

  const [totals, byStatus, byMonth, aging, topOutstanding, topInvoices] = await Promise.all([
    exec.query<{
      count: string;
      total_sum: string;
      outstanding_sum: string;
      paid_sum: string;
    }>(
      `SELECT
          COUNT(*) as count,
          COALESCE(SUM(total), 0) as total_sum,
          COALESCE(SUM(GREATEST(total - amount_paid, 0)), 0) as outstanding_sum,
          COALESCE(SUM(amount_paid), 0) as paid_sum
         FROM invoices
        WHERE issue_date >= $1 AND issue_date <= $2`,
      [fromDate, toDate],
    ),
    exec.query<{
      status: string;
      count: string;
      total_sum: string;
      outstanding_sum: string;
    }>(
      `SELECT status,
              COUNT(*) as count,
              COALESCE(SUM(total), 0) as total_sum,
              COALESCE(SUM(GREATEST(total - amount_paid, 0)), 0) as outstanding_sum
         FROM invoices
        WHERE issue_date >= $1 AND issue_date <= $2
        GROUP BY status
        ORDER BY count DESC`,
      [fromDate, toDate],
    ),
    exec.query<{
      label: string;
      count: string;
      total_sum: string;
      outstanding_sum: string;
    }>(
      `SELECT
          TO_CHAR(DATE_TRUNC('month', issue_date), 'YYYY-MM') as label,
          COUNT(*) as count,
          COALESCE(SUM(total), 0) as total_sum,
          COALESCE(SUM(GREATEST(total - amount_paid, 0)), 0) as outstanding_sum
         FROM invoices
        WHERE issue_date >= $1 AND issue_date <= $2
        GROUP BY DATE_TRUNC('month', issue_date)
        ORDER BY label ASC`,
      [fromDate, toDate],
    ),
    exec.query<{ bucket: string; count: string; outstanding_sum: string }>(
      `SELECT
          CASE
            WHEN CURRENT_DATE - due_date <= 30 THEN '0-30'
            WHEN CURRENT_DATE - due_date <= 60 THEN '31-60'
            WHEN CURRENT_DATE - due_date <= 90 THEN '61-90'
            ELSE '90+'
          END as bucket,
          COUNT(*) as count,
          COALESCE(SUM(GREATEST(total - amount_paid, 0)), 0) as outstanding_sum
         FROM invoices
        WHERE issue_date >= $1
          AND issue_date <= $2
          AND GREATEST(total - amount_paid, 0) > 0
        GROUP BY bucket
        ORDER BY bucket ASC`,
      [fromDate, toDate],
    ),
    exec.query<{ label: string; invoice_count: string; value: string }>(
      `SELECT
          client_name as label,
          COUNT(*) as invoice_count,
          COALESCE(SUM(GREATEST(total - amount_paid, 0)), 0) as value
         FROM invoices
        WHERE issue_date >= $1 AND issue_date <= $2
        GROUP BY client_name
        ORDER BY value DESC
        LIMIT ${topLimit}`,
      [fromDate, toDate],
    ),
    exec.query<{
      id: string;
      client_name: string;
      status: string;
      due_date: string;
      outstanding: string;
    }>(
      `SELECT
          id,
          client_name,
          status,
          due_date,
          GREATEST(total - amount_paid, 0) as outstanding
         FROM invoices
        WHERE issue_date >= $1 AND issue_date <= $2
        ORDER BY outstanding DESC
        LIMIT ${topLimit}`,
      [fromDate, toDate],
    ),
  ]);

  return {
    totals: {
      count: toNumber(totals.rows[0]?.count),
      total: toNumber(totals.rows[0]?.total_sum),
      outstanding: toNumber(totals.rows[0]?.outstanding_sum),
      paidAmount: toNumber(totals.rows[0]?.paid_sum),
    },
    byMonth: byMonth.rows.map((r) => ({
      label: toText(r.label),
      count: toNumber(r.count),
      total: toNumber(r.total_sum),
      outstanding: toNumber(r.outstanding_sum),
    })),
    aging: aging.rows.map((r) => ({
      bucket: toText(r.bucket),
      count: toNumber(r.count),
      outstanding: toNumber(r.outstanding_sum),
    })),
    byStatus: byStatus.rows.map((r) => ({
      status: toText(r.status),
      count: toNumber(r.count),
      total: toNumber(r.total_sum),
      outstanding: toNumber(r.outstanding_sum),
    })),
    topInvoicesByOutstanding: topInvoices.rows.map((r) => ({
      id: toText(r.id),
      invoiceNumber: toText(r.id),
      clientName: toText(r.client_name),
      status: toText(r.status),
      dueDate: toText(r.due_date),
      outstanding: toNumber(r.outstanding),
    })),
    topClientsByOutstanding: topOutstanding.rows.map((r) => ({
      label: toText(r.label),
      value: toNumber(r.value),
      invoiceCount: toNumber(r.invoice_count),
    })),
  };
};
