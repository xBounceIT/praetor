import { sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { toDbNumber, toDbText } from '../utils/parse.ts';

type SupplierRow = {
  id: string;
  name: string | null;
  supplier_code: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  is_disabled: boolean | null;
};

export type SuppliersSectionOptions = {
  fromDate: string;
  toDate: string;
  canViewSupplierQuotes: boolean;
  canListProducts: boolean;
  itemsLimit: number;
};

export type SupplierInfo = {
  id: string;
  name: string;
  supplierCode: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  isDisabled: boolean;
};

export type SupplierActivity = {
  supplierId: string;
  quotesCount: number | null;
  quotesNet: number | null;
  productsCount: number | null;
};

export type SuppliersSection = {
  count: number;
  activeCount: number;
  disabledCount: number;
  items: SupplierInfo[];
  activitySummary: SupplierActivity[];
};

export const getSuppliersSection = async (
  opts: SuppliersSectionOptions,
  exec: DbExecutor = db,
): Promise<SuppliersSection> => {
  const { fromDate, toDate, canViewSupplierQuotes, canListProducts, itemsLimit } = opts;

  const [summaryRows, listRows] = await Promise.all([
    executeRows<{ count: string; disabled_count: string }>(
      exec,
      sql`SELECT
          COUNT(*) as count,
          SUM(CASE WHEN is_disabled THEN 1 ELSE 0 END) as disabled_count
         FROM suppliers`,
    ),
    executeRows<SupplierRow>(
      exec,
      sql`SELECT
          id,
          name,
          supplier_code,
          contact_name,
          email,
          phone,
          address,
          is_disabled
         FROM suppliers
        ORDER BY name ASC
        LIMIT ${itemsLimit}`,
    ),
  ]);

  const items: SupplierInfo[] = listRows.map((r) => ({
    id: toDbText(r.id),
    name: toDbText(r.name),
    supplierCode: toDbText(r.supplier_code),
    contactName: toDbText(r.contact_name),
    email: toDbText(r.email),
    phone: toDbText(r.phone),
    address: toDbText(r.address),
    isDisabled: Boolean(r.is_disabled),
  }));

  const supplierIds = items.map((s) => s.id).filter(Boolean);
  const activityBySupplier = new Map<string, SupplierActivity>();
  for (const supplierId of supplierIds) {
    activityBySupplier.set(supplierId, {
      supplierId,
      quotesCount: null,
      quotesNet: null,
      productsCount: null,
    });
  }

  if (supplierIds.length > 0) {
    const quoteStatsPromise = canViewSupplierQuotes
      ? executeRows<{ supplier_id: string; quote_count: string; net_value: string }>(
          exec,
          sql`WITH per_quote AS (
              SELECT
                sq.id,
                sq.supplier_id,
                SUM(sqi.quantity * sqi.unit_price) as net_value
              FROM supplier_quotes sq
              JOIN supplier_quote_items sqi ON sqi.quote_id = sq.id
             WHERE sq.created_at::date >= ${fromDate}
               AND sq.created_at::date <= ${toDate}
               AND sq.supplier_id = ANY(${sql.param(supplierIds)})
             GROUP BY sq.id
           )
          SELECT
            supplier_id,
            COUNT(*) as quote_count,
            COALESCE(SUM(net_value), 0) as net_value
            FROM per_quote
           GROUP BY supplier_id`,
        )
      : null;

    const productStatsPromise = canListProducts
      ? executeRows<{ supplier_id: string; product_count: string }>(
          exec,
          sql`SELECT supplier_id, COUNT(*) as product_count
             FROM products
            WHERE supplier_id = ANY(${sql.param(supplierIds)})
            GROUP BY supplier_id`,
        )
      : null;

    const [quoteStatsRows, productStatsRows] = await Promise.all([
      quoteStatsPromise,
      productStatsPromise,
    ]);

    if (quoteStatsRows) {
      for (const row of quoteStatsRows) {
        const target = activityBySupplier.get(toDbText(row.supplier_id));
        if (!target) continue;
        target.quotesCount = toDbNumber(row.quote_count);
        target.quotesNet = toDbNumber(row.net_value);
      }
    }

    if (productStatsRows) {
      for (const row of productStatsRows) {
        const target = activityBySupplier.get(toDbText(row.supplier_id));
        if (!target) continue;
        target.productsCount = toDbNumber(row.product_count);
      }
    }
  }

  const supplierCount = toDbNumber(summaryRows[0]?.count);
  const supplierDisabledCount = toDbNumber(summaryRows[0]?.disabled_count);

  return {
    count: supplierCount,
    activeCount: Math.max(supplierCount - supplierDisabledCount, 0),
    disabledCount: supplierDisabledCount,
    items,
    activitySummary: Array.from(activityBySupplier.values()),
  };
};

export type SupplierQuotesSectionOptions = {
  fromDate: string;
  toDate: string;
  topLimit: number;
};

export type SupplierQuotesSection = {
  totals: { count: number; totalNet: number; avgNet: number };
  byMonth: Array<{ label: string; count: number; totalNet: number }>;
  byStatus: Array<{ status: string; count: number; totalNet: number }>;
  topQuotesByNet: Array<{
    id: string;
    supplierName: string;
    purchaseOrderNumber: string;
    status: string;
    netValue: number;
    createdAt: number;
  }>;
  topSuppliersByNet: Array<{ label: string; value: number; quoteCount: number }>;
};

export const getSupplierQuotesSection = async (
  opts: SupplierQuotesSectionOptions,
  exec: DbExecutor = db,
): Promise<SupplierQuotesSection> => {
  const { fromDate, toDate, topLimit } = opts;

  const [totals, byStatus, byMonth, topSuppliers, topQuotes] = await Promise.all([
    executeRows<{ count: string; total_net: string; avg_net: string }>(
      exec,
      sql`WITH per_quote AS (
          SELECT
            sq.id,
            SUM(sqi.quantity * sqi.unit_price) as net_value
            FROM supplier_quotes sq
            JOIN supplier_quote_items sqi ON sqi.quote_id = sq.id
           WHERE sq.created_at::date >= ${fromDate} AND sq.created_at::date <= ${toDate}
           GROUP BY sq.id
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
            sq.id,
            sq.status,
            sq.supplier_name,
            sq.created_at,
            SUM(sqi.quantity * sqi.unit_price) as net_value
            FROM supplier_quotes sq
            JOIN supplier_quote_items sqi ON sqi.quote_id = sq.id
           WHERE sq.created_at::date >= ${fromDate} AND sq.created_at::date <= ${toDate}
           GROUP BY sq.id
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
            sq.id,
            sq.created_at,
            SUM(sqi.quantity * sqi.unit_price) as net_value
            FROM supplier_quotes sq
            JOIN supplier_quote_items sqi ON sqi.quote_id = sq.id
           WHERE sq.created_at::date >= ${fromDate} AND sq.created_at::date <= ${toDate}
           GROUP BY sq.id
         )
        SELECT
          TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') as label,
          COUNT(*) as count,
          COALESCE(SUM(net_value), 0) as total_net
          FROM per_quote
         GROUP BY DATE_TRUNC('month', created_at)
         ORDER BY label ASC`,
    ),
    executeRows<{ label: string; quote_count: string; value: string }>(
      exec,
      sql`WITH per_quote AS (
          SELECT
            sq.id,
            sq.supplier_name,
            SUM(sqi.quantity * sqi.unit_price) as net_value
            FROM supplier_quotes sq
            JOIN supplier_quote_items sqi ON sqi.quote_id = sq.id
           WHERE sq.created_at::date >= ${fromDate} AND sq.created_at::date <= ${toDate}
           GROUP BY sq.id
         )
        SELECT
          supplier_name as label,
          COUNT(*) as quote_count,
          COALESCE(SUM(net_value), 0) as value
          FROM per_quote
         GROUP BY supplier_name
         ORDER BY value DESC
         LIMIT ${topLimit}`,
    ),
    executeRows<{
      id: string;
      supplier_name: string;
      status: string;
      net_value: string;
      created_at: string;
    }>(
      exec,
      sql`WITH per_quote AS (
          SELECT
            sq.id,
            sq.supplier_name,
            sq.status,
            sq.created_at,
            SUM(sqi.quantity * sqi.unit_price) as net_value
            FROM supplier_quotes sq
            JOIN supplier_quote_items sqi ON sqi.quote_id = sq.id
           WHERE sq.created_at::date >= ${fromDate} AND sq.created_at::date <= ${toDate}
           GROUP BY sq.id
         )
        SELECT
          id,
          supplier_name,
          status,
          net_value,
          EXTRACT(EPOCH FROM created_at) * 1000 as created_at
          FROM per_quote
         ORDER BY net_value DESC
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
        supplierName: toDbText(r.supplier_name),
        purchaseOrderNumber: id,
        status: toDbText(r.status),
        netValue: toDbNumber(r.net_value),
        createdAt: toDbNumber(r.created_at),
      };
    }),
    topSuppliersByNet: topSuppliers.map((r) => ({
      label: toDbText(r.label),
      value: toDbNumber(r.value),
      quoteCount: toDbNumber(r.quote_count),
    })),
  };
};

export type CatalogSectionOptions = {
  fromDate: string;
  toDate: string;
  topLimit: number;
};

export type CatalogSection = {
  productCounts: { internal: number; external: number; disabled: number };
  byType: Array<{ label: string; value: number }>;
  byCategory: Array<{ label: string; value: number }>;
  bySubcategory: Array<{ label: string; value: number }>;
  productsBySupplierCount: Array<{ label: string; value: number }>;
  topProductsByUsage: Array<{
    productId: string;
    productName: string;
    usageCount: number;
    quantity: number;
  }>;
  topProductsByRevenue: Array<{
    productId: string;
    productName: string;
    value: number;
  }>;
};

export const getCatalogSection = async (
  opts: CatalogSectionOptions,
  exec: DbExecutor = db,
): Promise<CatalogSection> => {
  const { fromDate, toDate, topLimit } = opts;

  const [
    counts,
    byType,
    byCategory,
    bySubcategory,
    productsBySupplier,
    topProductsByUsage,
    topProductsByRevenue,
  ] = await Promise.all([
    executeRows<{ internal_count: string; external_count: string; disabled_count: string }>(
      exec,
      sql`SELECT
          SUM(CASE WHEN supplier_id IS NULL THEN 1 ELSE 0 END) as internal_count,
          SUM(CASE WHEN supplier_id IS NOT NULL THEN 1 ELSE 0 END) as external_count,
          SUM(CASE WHEN is_disabled THEN 1 ELSE 0 END) as disabled_count
         FROM products`,
    ),
    executeRows<{ label: string; value: string }>(
      exec,
      sql`SELECT COALESCE(NULLIF(type, ''), 'unknown') as label, COUNT(*) as value
         FROM products
        GROUP BY COALESCE(NULLIF(type, ''), 'unknown')
        ORDER BY value DESC`,
    ),
    executeRows<{ label: string; value: string }>(
      exec,
      sql`SELECT COALESCE(NULLIF(category, ''), 'uncategorized') as label, COUNT(*) as value
         FROM products
        GROUP BY COALESCE(NULLIF(category, ''), 'uncategorized')
        ORDER BY value DESC`,
    ),
    executeRows<{ label: string; value: string }>(
      exec,
      sql`SELECT COALESCE(NULLIF(subcategory, ''), 'none') as label, COUNT(*) as value
         FROM products
        GROUP BY COALESCE(NULLIF(subcategory, ''), 'none')
        ORDER BY value DESC`,
    ),
    executeRows<{ label: string; value: string }>(
      exec,
      sql`SELECT COALESCE(s.name, 'Unknown') as label, COUNT(*) as value
         FROM products p
         LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.supplier_id IS NOT NULL
        GROUP BY COALESCE(s.name, 'Unknown')
        ORDER BY value DESC
        LIMIT ${topLimit}`,
    ),
    executeRows<{
      product_id: string;
      product_name: string;
      usage_count: string;
      quantity_total: string;
    }>(
      exec,
      sql`WITH usage_rows AS (
          SELECT qi.product_id, qi.product_name, COUNT(*) as use_count, COALESCE(SUM(qi.quantity), 0) as quantity_total
            FROM quote_items qi
            JOIN quotes q ON q.id = qi.quote_id
           WHERE q.created_at::date >= ${fromDate} AND q.created_at::date <= ${toDate}
           GROUP BY qi.product_id, qi.product_name
          UNION ALL
          SELECT si.product_id, si.product_name, COUNT(*) as use_count, COALESCE(SUM(si.quantity), 0) as quantity_total
            FROM sale_items si
            JOIN sales s ON s.id = si.sale_id
           WHERE s.created_at::date >= ${fromDate} AND s.created_at::date <= ${toDate}
           GROUP BY si.product_id, si.product_name
          UNION ALL
          SELECT ii.product_id, ii.description as product_name, COUNT(*) as use_count, COALESCE(SUM(ii.quantity), 0) as quantity_total
            FROM invoice_items ii
            JOIN invoices i ON i.id = ii.invoice_id
           WHERE i.issue_date >= ${fromDate} AND i.issue_date <= ${toDate} AND ii.product_id IS NOT NULL
           GROUP BY ii.product_id, ii.description
         )
        SELECT
          product_id,
          product_name,
          COALESCE(SUM(use_count), 0) as usage_count,
          COALESCE(SUM(quantity_total), 0) as quantity_total
          FROM usage_rows
         GROUP BY product_id, product_name
         ORDER BY usage_count DESC, quantity_total DESC
         LIMIT ${topLimit}`,
    ),
    executeRows<{ product_id: string; product_name: string; value: string }>(
      exec,
      sql`SELECT
          si.product_id,
          si.product_name,
          COALESCE(
            SUM(
              si.quantity
              * si.unit_price
              * (1 - COALESCE(si.discount, 0) / 100.0)
              * (1 - COALESCE(s.discount, 0) / 100.0)
            ),
            0
          ) as value
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
        WHERE s.created_at::date >= ${fromDate} AND s.created_at::date <= ${toDate}
        GROUP BY si.product_id, si.product_name
        ORDER BY value DESC
        LIMIT ${topLimit}`,
    ),
  ]);

  return {
    productCounts: {
      internal: toDbNumber(counts[0]?.internal_count),
      external: toDbNumber(counts[0]?.external_count),
      disabled: toDbNumber(counts[0]?.disabled_count),
    },
    byType: byType.map((r) => ({ label: toDbText(r.label), value: toDbNumber(r.value) })),
    byCategory: byCategory.map((r) => ({
      label: toDbText(r.label),
      value: toDbNumber(r.value),
    })),
    bySubcategory: bySubcategory.map((r) => ({
      label: toDbText(r.label),
      value: toDbNumber(r.value),
    })),
    productsBySupplierCount: productsBySupplier.map((r) => ({
      label: toDbText(r.label),
      value: toDbNumber(r.value),
    })),
    topProductsByUsage: topProductsByUsage.map((r) => ({
      productId: toDbText(r.product_id),
      productName: toDbText(r.product_name),
      usageCount: toDbNumber(r.usage_count),
      quantity: toDbNumber(r.quantity_total),
    })),
    topProductsByRevenue: topProductsByRevenue.map((r) => ({
      productId: toDbText(r.product_id),
      productName: toDbText(r.product_name),
      value: toDbNumber(r.value),
    })),
  };
};
