import { type SQL, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { roundCurrency } from '../utils/invoice-math.ts';
import { toDbNumber, toDbText } from '../utils/parse.ts';
import { clientOfferNetValueSql, supplierOrderNetValueSql } from './reportsCommercialSql.ts';

export type BusinessDocumentDateRangeOptions = {
  fromDate: string;
  toDate: string;
  topLimit: number;
};

export type CommercialDocumentsSection = {
  totals: { count: number; totalNet: number; avgNet: number };
  byMonth: Array<{ label: string; count: number; totalNet: number }>;
  byStatus: Array<{ status: string; count: number; totalNet: number }>;
  topDocumentsByNet: Array<{
    id: string;
    partnerName: string;
    status: string;
    dueDate: string;
    netValue: number;
    createdAt: number;
  }>;
  topPartnersByNet: Array<{ label: string; value: number; documentCount: number }>;
};

const getCommercialDocumentsSection = async (
  opts: BusinessDocumentDateRangeOptions,
  perDocumentCte: SQL,
  exec: DbExecutor,
): Promise<CommercialDocumentsSection> => {
  const { topLimit } = opts;
  const [totals, byStatus, byMonth, topDocuments, topPartners] = await Promise.all([
    executeRows<{ count: string; total_net: string; avg_net: string }>(
      exec,
      sql`${perDocumentCte}
        SELECT COUNT(*) as count,
               COALESCE(SUM(net_value), 0) as total_net,
               COALESCE(AVG(net_value), 0) as avg_net
          FROM per_document`,
    ),
    executeRows<{ status: string; count: string; total_net: string }>(
      exec,
      sql`${perDocumentCte}
        SELECT status, COUNT(*) as count, COALESCE(SUM(net_value), 0) as total_net
          FROM per_document
         GROUP BY status
         ORDER BY count DESC`,
    ),
    executeRows<{ label: string; count: string; total_net: string }>(
      exec,
      sql`${perDocumentCte}
        SELECT TO_CHAR(DATE_TRUNC('month', document_date), 'YYYY-MM') as label,
               COUNT(*) as count,
               COALESCE(SUM(net_value), 0) as total_net
          FROM per_document
         GROUP BY DATE_TRUNC('month', document_date)
         ORDER BY label ASC`,
    ),
    executeRows<{
      id: string;
      partner_name: string;
      status: string;
      due_date: string | null;
      net_value: string;
      created_at: string;
    }>(
      exec,
      sql`${perDocumentCte}
        SELECT id,
               partner_name,
               status,
               due_date,
               net_value,
               EXTRACT(EPOCH FROM document_date) * 1000 as created_at
          FROM per_document
         ORDER BY net_value DESC, document_date DESC
         LIMIT ${topLimit}`,
    ),
    executeRows<{ label: string; document_count: string; value: string }>(
      exec,
      sql`${perDocumentCte}
        SELECT partner_name as label,
               COUNT(*) as document_count,
               COALESCE(SUM(net_value), 0) as value
          FROM per_document
         GROUP BY partner_name
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
    byMonth: byMonth.map((row) => ({
      label: toDbText(row.label),
      count: toDbNumber(row.count),
      totalNet: toDbNumber(row.total_net),
    })),
    byStatus: byStatus.map((row) => ({
      status: toDbText(row.status),
      count: toDbNumber(row.count),
      totalNet: toDbNumber(row.total_net),
    })),
    topDocumentsByNet: topDocuments.map((row) => ({
      id: toDbText(row.id),
      partnerName: toDbText(row.partner_name),
      status: toDbText(row.status),
      dueDate: toDbText(row.due_date),
      netValue: toDbNumber(row.net_value),
      createdAt: toDbNumber(row.created_at),
    })),
    topPartnersByNet: topPartners.map((row) => ({
      label: toDbText(row.label),
      value: toDbNumber(row.value),
      documentCount: toDbNumber(row.document_count),
    })),
  };
};

export const getClientOffersSection = async (
  opts: BusinessDocumentDateRangeOptions,
  exec: DbExecutor = db,
): Promise<CommercialDocumentsSection> => {
  const { fromDate, toDate } = opts;
  const perDocumentCte = sql`WITH per_document AS (
    SELECT co.id,
           co.client_name as partner_name,
           co.status,
           co.created_at as document_date,
           co.expiration_date as due_date,
           ${clientOfferNetValueSql} as net_value
      FROM customer_offers co
      LEFT JOIN customer_offer_items coi ON coi.offer_id = co.id
     WHERE co.created_at::date >= ${fromDate} AND co.created_at::date <= ${toDate}
     GROUP BY co.id
  )`;
  return getCommercialDocumentsSection(opts, perDocumentCte, exec);
};

export const getSupplierOrdersSection = async (
  opts: BusinessDocumentDateRangeOptions,
  exec: DbExecutor = db,
): Promise<CommercialDocumentsSection> => {
  const { fromDate, toDate } = opts;
  const perDocumentCte = sql`WITH per_document AS (
    SELECT ss.id,
           ss.supplier_name as partner_name,
           ss.status,
           ss.created_at as document_date,
           NULL::date as due_date,
           ${supplierOrderNetValueSql} as net_value
      FROM supplier_sales ss
      LEFT JOIN supplier_sale_items ssi ON ssi.sale_id = ss.id
     WHERE ss.created_at::date >= ${fromDate} AND ss.created_at::date <= ${toDate}
     GROUP BY ss.id
  )`;
  return getCommercialDocumentsSection(opts, perDocumentCte, exec);
};

export type SupplierInvoicesSection = {
  totals: { count: number; total: number; outstanding: number; paidAmount: number };
  byMonth: Array<{ label: string; count: number; total: number; outstanding: number }>;
  aging: Array<{ bucket: string; count: number; outstanding: number }>;
  byStatus: Array<{ status: string; count: number; total: number; outstanding: number }>;
  topInvoicesByOutstanding: Array<{
    id: string;
    supplierName: string;
    status: string;
    dueDate: string;
    outstanding: number;
  }>;
  topSuppliersByOutstanding: Array<{ label: string; value: number; invoiceCount: number }>;
};

export const getSupplierInvoicesSection = async (
  opts: BusinessDocumentDateRangeOptions,
  exec: DbExecutor = db,
): Promise<SupplierInvoicesSection> => {
  const { fromDate, toDate, topLimit } = opts;
  const [totals, byStatus, byMonth, aging, topInvoices, topSuppliers] = await Promise.all([
    executeRows<{ count: string; total_sum: string; outstanding_sum: string; paid_sum: string }>(
      exec,
      sql`SELECT COUNT(*) as count,
                 COALESCE(SUM(total), 0) as total_sum,
                 COALESCE(SUM(GREATEST(total - amount_paid, 0)), 0) as outstanding_sum,
                 COALESCE(SUM(amount_paid), 0) as paid_sum
            FROM supplier_invoices
           WHERE issue_date >= ${fromDate} AND issue_date <= ${toDate}`,
    ),
    executeRows<{ status: string; count: string; total_sum: string; outstanding_sum: string }>(
      exec,
      sql`SELECT status,
                 COUNT(*) as count,
                 COALESCE(SUM(total), 0) as total_sum,
                 COALESCE(SUM(GREATEST(total - amount_paid, 0)), 0) as outstanding_sum
            FROM supplier_invoices
           WHERE issue_date >= ${fromDate} AND issue_date <= ${toDate}
           GROUP BY status
           ORDER BY count DESC`,
    ),
    executeRows<{ label: string; count: string; total_sum: string; outstanding_sum: string }>(
      exec,
      sql`SELECT TO_CHAR(DATE_TRUNC('month', issue_date), 'YYYY-MM') as label,
                 COUNT(*) as count,
                 COALESCE(SUM(total), 0) as total_sum,
                 COALESCE(SUM(GREATEST(total - amount_paid, 0)), 0) as outstanding_sum
            FROM supplier_invoices
           WHERE issue_date >= ${fromDate} AND issue_date <= ${toDate}
           GROUP BY DATE_TRUNC('month', issue_date)
           ORDER BY label ASC`,
    ),
    executeRows<{ bucket: string; count: string; outstanding_sum: string }>(
      exec,
      sql`SELECT CASE
                   WHEN CURRENT_DATE - due_date <= 30 THEN '0-30'
                   WHEN CURRENT_DATE - due_date <= 60 THEN '31-60'
                   WHEN CURRENT_DATE - due_date <= 90 THEN '61-90'
                   ELSE '90+'
                 END as bucket,
                 COUNT(*) as count,
                 COALESCE(SUM(GREATEST(total - amount_paid, 0)), 0) as outstanding_sum
            FROM supplier_invoices
           WHERE issue_date >= ${fromDate}
             AND issue_date <= ${toDate}
             AND GREATEST(total - amount_paid, 0) > 0
           GROUP BY bucket
           ORDER BY bucket ASC`,
    ),
    executeRows<{
      id: string;
      supplier_name: string;
      status: string;
      due_date: string;
      outstanding: string;
    }>(
      exec,
      sql`SELECT id,
                 supplier_name,
                 status,
                 due_date,
                 GREATEST(total - amount_paid, 0) as outstanding
            FROM supplier_invoices
           WHERE issue_date >= ${fromDate} AND issue_date <= ${toDate}
           ORDER BY outstanding DESC
           LIMIT ${topLimit}`,
    ),
    executeRows<{ label: string; invoice_count: string; value: string }>(
      exec,
      sql`SELECT supplier_name as label,
                 COUNT(*) as invoice_count,
                 COALESCE(SUM(GREATEST(total - amount_paid, 0)), 0) as value
            FROM supplier_invoices
           WHERE issue_date >= ${fromDate} AND issue_date <= ${toDate}
           GROUP BY supplier_name
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
    byMonth: byMonth.map((row) => ({
      label: toDbText(row.label),
      count: toDbNumber(row.count),
      total: toDbNumber(row.total_sum),
      outstanding: toDbNumber(row.outstanding_sum),
    })),
    aging: aging.map((row) => ({
      bucket: toDbText(row.bucket),
      count: toDbNumber(row.count),
      outstanding: toDbNumber(row.outstanding_sum),
    })),
    byStatus: byStatus.map((row) => ({
      status: toDbText(row.status),
      count: toDbNumber(row.count),
      total: toDbNumber(row.total_sum),
      outstanding: toDbNumber(row.outstanding_sum),
    })),
    topInvoicesByOutstanding: topInvoices.map((row) => ({
      id: toDbText(row.id),
      supplierName: toDbText(row.supplier_name),
      status: toDbText(row.status),
      dueDate: toDbText(row.due_date),
      outstanding: toDbNumber(row.outstanding),
    })),
    topSuppliersByOutstanding: topSuppliers.map((row) => ({
      label: toDbText(row.label),
      value: toDbNumber(row.value),
      invoiceCount: toDbNumber(row.invoice_count),
    })),
  };
};

export type ResalesSection = {
  totals: {
    count: number;
    activityCount: number;
    releasedActivityCount: number;
    overdueActivityCount: number;
    cost: number;
    revenue: number;
    margin: number;
  };
  byBillingFrequency: Array<{
    label: string;
    activityCount: number;
    cost: number;
    revenue: number;
    margin: number;
  }>;
  byCategory: Array<{
    label: string;
    activityCount: number;
    cost: number;
    revenue: number;
    margin: number;
  }>;
  topResalesByMargin: Array<{
    id: string;
    clientOrderId: string;
    clientName: string;
    supplierOrderId: string;
    supplierName: string;
    activityCount: number;
    cost: number;
    revenue: number;
    margin: number;
  }>;
};

export const getResalesSection = async (
  opts: BusinessDocumentDateRangeOptions,
  exec: DbExecutor = db,
): Promise<ResalesSection> => {
  const { fromDate, toDate, topLimit } = opts;
  const dateFilter = sql`r.created_at::date >= ${fromDate} AND r.created_at::date <= ${toDate}`;
  const [totals, byFrequency, byCategory, topResales] = await Promise.all([
    executeRows<{
      count: string;
      activity_count: string;
      released_count: string;
      overdue_count: string;
      cost: string;
      revenue: string;
    }>(
      exec,
      sql`SELECT COUNT(DISTINCT r.id) as count,
                 COUNT(ra.id) as activity_count,
                 COUNT(ra.id) FILTER (WHERE ra.released) as released_count,
                 COUNT(ra.id) FILTER (
                   WHERE NOT ra.released AND ra.due_date IS NOT NULL AND ra.due_date < CURRENT_DATE
                 ) as overdue_count,
                 COALESCE(SUM(ra.cost), 0) as cost,
                 COALESCE(SUM(ra.revenue), 0) as revenue
            FROM resales r
            LEFT JOIN resale_activities ra ON ra.resale_id = r.id
           WHERE ${dateFilter}`,
    ),
    executeRows<{
      label: string;
      activity_count: string;
      cost: string;
      revenue: string;
    }>(
      exec,
      sql`SELECT COALESCE(ra.billing_frequency, 'none') as label,
                 COUNT(ra.id) as activity_count,
                 COALESCE(SUM(ra.cost), 0) as cost,
                 COALESCE(SUM(ra.revenue), 0) as revenue
            FROM resales r
            JOIN resale_activities ra ON ra.resale_id = r.id
           WHERE ${dateFilter}
           GROUP BY ra.billing_frequency
           ORDER BY revenue DESC`,
    ),
    executeRows<{
      label: string;
      activity_count: string;
      cost: string;
      revenue: string;
    }>(
      exec,
      sql`SELECT rc.name as label,
                 COUNT(ra.id) as activity_count,
                 COALESCE(SUM(ra.cost), 0) as cost,
                 COALESCE(SUM(ra.revenue), 0) as revenue
            FROM resales r
            JOIN resale_activities ra ON ra.resale_id = r.id
            JOIN resale_categories rc ON rc.id = ra.category_id
           WHERE ${dateFilter}
           GROUP BY rc.name
           ORDER BY revenue DESC`,
    ),
    executeRows<{
      id: string;
      client_order_id: string;
      client_name: string;
      supplier_order_id: string;
      supplier_name: string;
      activity_count: string;
      cost: string;
      revenue: string;
      margin: string;
    }>(
      exec,
      sql`SELECT r.id,
                 r.client_order_id,
                 cs.client_name,
                 r.supplier_order_id,
                 ss.supplier_name,
                 COUNT(ra.id) as activity_count,
                 COALESCE(SUM(ra.cost), 0) as cost,
                 COALESCE(SUM(ra.revenue), 0) as revenue,
                 COALESCE(SUM(ra.revenue - ra.cost), 0) as margin
            FROM resales r
            JOIN sales cs ON cs.id = r.client_order_id
            JOIN supplier_sales ss ON ss.id = r.supplier_order_id
            LEFT JOIN resale_activities ra ON ra.resale_id = r.id
           WHERE ${dateFilter}
           GROUP BY r.id, cs.client_name, ss.supplier_name
           ORDER BY margin DESC
           LIMIT ${topLimit}`,
    ),
  ]);

  const mapBreakdown = (rows: typeof byFrequency) =>
    rows.map((row) => {
      const cost = toDbNumber(row.cost);
      const revenue = toDbNumber(row.revenue);
      return {
        label: toDbText(row.label),
        activityCount: toDbNumber(row.activity_count),
        cost,
        revenue,
        margin: roundCurrency(revenue - cost),
      };
    });
  const totalCost = toDbNumber(totals[0]?.cost);
  const totalRevenue = toDbNumber(totals[0]?.revenue);

  return {
    totals: {
      count: toDbNumber(totals[0]?.count),
      activityCount: toDbNumber(totals[0]?.activity_count),
      releasedActivityCount: toDbNumber(totals[0]?.released_count),
      overdueActivityCount: toDbNumber(totals[0]?.overdue_count),
      cost: totalCost,
      revenue: totalRevenue,
      margin: roundCurrency(totalRevenue - totalCost),
    },
    byBillingFrequency: mapBreakdown(byFrequency),
    byCategory: mapBreakdown(byCategory),
    topResalesByMargin: topResales.map((row) => ({
      id: toDbText(row.id),
      clientOrderId: toDbText(row.client_order_id),
      clientName: toDbText(row.client_name),
      supplierOrderId: toDbText(row.supplier_order_id),
      supplierName: toDbText(row.supplier_name),
      activityCount: toDbNumber(row.activity_count),
      cost: toDbNumber(row.cost),
      revenue: toDbNumber(row.revenue),
      margin: toDbNumber(row.margin),
    })),
  };
};
