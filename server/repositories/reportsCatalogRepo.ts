import pool, { type QueryExecutor } from '../db/index.ts';
import { toDbNumber as toNumber, toDbText as toText } from '../utils/parse.ts';

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
  exec: QueryExecutor = pool,
): Promise<SuppliersSection> => {
  const { fromDate, toDate, canViewSupplierQuotes, canListProducts, itemsLimit } = opts;

  const [summaryRes, listRes] = await Promise.all([
    exec.query<{ count: string; disabled_count: string }>(
      `SELECT
          COUNT(*) as count,
          SUM(CASE WHEN is_disabled THEN 1 ELSE 0 END) as disabled_count
         FROM suppliers`,
    ),
    exec.query<SupplierRow>(
      `SELECT
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
        LIMIT $1`,
      [itemsLimit],
    ),
  ]);

  const items: SupplierInfo[] = listRes.rows.map((r) => ({
    id: toText(r.id),
    name: toText(r.name),
    supplierCode: toText(r.supplier_code),
    contactName: toText(r.contact_name),
    email: toText(r.email),
    phone: toText(r.phone),
    address: toText(r.address),
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
      ? exec.query<{ supplier_id: string; quote_count: string; net_value: string }>(
          `WITH per_quote AS (
              SELECT
                sq.id,
                sq.supplier_id,
                SUM(sqi.quantity * sqi.unit_price) as net_value
              FROM supplier_quotes sq
              JOIN supplier_quote_items sqi ON sqi.quote_id = sq.id
             WHERE sq.created_at::date >= $1
               AND sq.created_at::date <= $2
               AND sq.supplier_id = ANY($3)
             GROUP BY sq.id
           )
          SELECT
            supplier_id,
            COUNT(*) as quote_count,
            COALESCE(SUM(net_value), 0) as net_value
            FROM per_quote
           GROUP BY supplier_id`,
          [fromDate, toDate, supplierIds],
        )
      : null;

    const productStatsPromise = canListProducts
      ? exec.query<{ supplier_id: string; product_count: string }>(
          `SELECT supplier_id, COUNT(*) as product_count
             FROM products
            WHERE supplier_id = ANY($1)
            GROUP BY supplier_id`,
          [supplierIds],
        )
      : null;

    const [quoteStats, productStats] = await Promise.all([quoteStatsPromise, productStatsPromise]);

    if (quoteStats) {
      for (const row of quoteStats.rows) {
        const target = activityBySupplier.get(toText(row.supplier_id));
        if (!target) continue;
        target.quotesCount = toNumber(row.quote_count);
        target.quotesNet = toNumber(row.net_value);
      }
    }

    if (productStats) {
      for (const row of productStats.rows) {
        const target = activityBySupplier.get(toText(row.supplier_id));
        if (!target) continue;
        target.productsCount = toNumber(row.product_count);
      }
    }
  }

  const supplierCount = toNumber(summaryRes.rows[0]?.count);
  const supplierDisabledCount = toNumber(summaryRes.rows[0]?.disabled_count);

  return {
    count: supplierCount,
    activeCount: Math.max(supplierCount - supplierDisabledCount, 0),
    disabledCount: supplierDisabledCount,
    items,
    activitySummary: supplierIds
      .map((id) => activityBySupplier.get(id))
      .filter((a): a is SupplierActivity => a !== undefined),
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
  exec: QueryExecutor = pool,
): Promise<SupplierQuotesSection> => {
  const { fromDate, toDate, topLimit } = opts;

  const [totals, byStatus, byMonth, topSuppliers, topQuotes] = await Promise.all([
    exec.query<{ count: string; total_net: string; avg_net: string }>(
      `WITH per_quote AS (
          SELECT
            sq.id,
            SUM(sqi.quantity * sqi.unit_price) as net_value
            FROM supplier_quotes sq
            JOIN supplier_quote_items sqi ON sqi.quote_id = sq.id
           WHERE sq.created_at::date >= $1 AND sq.created_at::date <= $2
           GROUP BY sq.id
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
            sq.id,
            sq.status,
            sq.supplier_name,
            sq.created_at,
            SUM(sqi.quantity * sqi.unit_price) as net_value
            FROM supplier_quotes sq
            JOIN supplier_quote_items sqi ON sqi.quote_id = sq.id
           WHERE sq.created_at::date >= $1 AND sq.created_at::date <= $2
           GROUP BY sq.id
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
            sq.id,
            sq.created_at,
            SUM(sqi.quantity * sqi.unit_price) as net_value
            FROM supplier_quotes sq
            JOIN supplier_quote_items sqi ON sqi.quote_id = sq.id
           WHERE sq.created_at::date >= $1 AND sq.created_at::date <= $2
           GROUP BY sq.id
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
    exec.query<{ label: string; quote_count: string; value: string }>(
      `WITH per_quote AS (
          SELECT
            sq.id,
            sq.supplier_name,
            SUM(sqi.quantity * sqi.unit_price) as net_value
            FROM supplier_quotes sq
            JOIN supplier_quote_items sqi ON sqi.quote_id = sq.id
           WHERE sq.created_at::date >= $1 AND sq.created_at::date <= $2
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
      [fromDate, toDate],
    ),
    exec.query<{
      id: string;
      supplier_name: string;
      status: string;
      net_value: string;
      created_at: string;
    }>(
      `WITH per_quote AS (
          SELECT
            sq.id,
            sq.supplier_name,
            sq.status,
            sq.created_at,
            SUM(sqi.quantity * sqi.unit_price) as net_value
            FROM supplier_quotes sq
            JOIN supplier_quote_items sqi ON sqi.quote_id = sq.id
           WHERE sq.created_at::date >= $1 AND sq.created_at::date <= $2
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
      supplierName: toText(r.supplier_name),
      purchaseOrderNumber: toText(r.id),
      status: toText(r.status),
      netValue: toNumber(r.net_value),
      createdAt: toNumber(r.created_at),
    })),
    topSuppliersByNet: topSuppliers.rows.map((r) => ({
      label: toText(r.label),
      value: toNumber(r.value),
      quoteCount: toNumber(r.quote_count),
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
  exec: QueryExecutor = pool,
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
    exec.query<{ internal_count: string; external_count: string; disabled_count: string }>(
      `SELECT
          SUM(CASE WHEN supplier_id IS NULL THEN 1 ELSE 0 END) as internal_count,
          SUM(CASE WHEN supplier_id IS NOT NULL THEN 1 ELSE 0 END) as external_count,
          SUM(CASE WHEN is_disabled THEN 1 ELSE 0 END) as disabled_count
         FROM products`,
    ),
    exec.query<{ label: string; value: string }>(
      `SELECT COALESCE(NULLIF(type, ''), 'unknown') as label, COUNT(*) as value
         FROM products
        GROUP BY COALESCE(NULLIF(type, ''), 'unknown')
        ORDER BY value DESC`,
    ),
    exec.query<{ label: string; value: string }>(
      `SELECT COALESCE(NULLIF(category, ''), 'uncategorized') as label, COUNT(*) as value
         FROM products
        GROUP BY COALESCE(NULLIF(category, ''), 'uncategorized')
        ORDER BY value DESC`,
    ),
    exec.query<{ label: string; value: string }>(
      `SELECT COALESCE(NULLIF(subcategory, ''), 'none') as label, COUNT(*) as value
         FROM products
        GROUP BY COALESCE(NULLIF(subcategory, ''), 'none')
        ORDER BY value DESC`,
    ),
    exec.query<{ label: string; value: string }>(
      `SELECT COALESCE(s.name, 'Unknown') as label, COUNT(*) as value
         FROM products p
         LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.supplier_id IS NOT NULL
        GROUP BY COALESCE(s.name, 'Unknown')
        ORDER BY value DESC
        LIMIT ${topLimit}`,
    ),
    exec.query<{
      product_id: string;
      product_name: string;
      usage_count: string;
      quantity_total: string;
    }>(
      `WITH usage_rows AS (
          SELECT qi.product_id, qi.product_name, COUNT(*) as use_count, COALESCE(SUM(qi.quantity), 0) as quantity_total
            FROM quote_items qi
            JOIN quotes q ON q.id = qi.quote_id
           WHERE q.created_at::date >= $1 AND q.created_at::date <= $2
           GROUP BY qi.product_id, qi.product_name
          UNION ALL
          SELECT si.product_id, si.product_name, COUNT(*) as use_count, COALESCE(SUM(si.quantity), 0) as quantity_total
            FROM sale_items si
            JOIN sales s ON s.id = si.sale_id
           WHERE s.created_at::date >= $1 AND s.created_at::date <= $2
           GROUP BY si.product_id, si.product_name
          UNION ALL
          SELECT ii.product_id, ii.description as product_name, COUNT(*) as use_count, COALESCE(SUM(ii.quantity), 0) as quantity_total
            FROM invoice_items ii
            JOIN invoices i ON i.id = ii.invoice_id
           WHERE i.issue_date >= $1 AND i.issue_date <= $2 AND ii.product_id IS NOT NULL
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
      [fromDate, toDate],
    ),
    exec.query<{ product_id: string; product_name: string; value: string }>(
      `SELECT
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
        WHERE s.created_at::date >= $1 AND s.created_at::date <= $2
        GROUP BY si.product_id, si.product_name
        ORDER BY value DESC
        LIMIT ${topLimit}`,
      [fromDate, toDate],
    ),
  ]);

  return {
    productCounts: {
      internal: toNumber(counts.rows[0]?.internal_count),
      external: toNumber(counts.rows[0]?.external_count),
      disabled: toNumber(counts.rows[0]?.disabled_count),
    },
    byType: byType.rows.map((r) => ({ label: toText(r.label), value: toNumber(r.value) })),
    byCategory: byCategory.rows.map((r) => ({
      label: toText(r.label),
      value: toNumber(r.value),
    })),
    bySubcategory: bySubcategory.rows.map((r) => ({
      label: toText(r.label),
      value: toNumber(r.value),
    })),
    productsBySupplierCount: productsBySupplier.rows.map((r) => ({
      label: toText(r.label),
      value: toNumber(r.value),
    })),
    topProductsByUsage: topProductsByUsage.rows.map((r) => ({
      productId: toText(r.product_id),
      productName: toText(r.product_name),
      usageCount: toNumber(r.usage_count),
      quantity: toNumber(r.quantity_total),
    })),
    topProductsByRevenue: topProductsByRevenue.rows.map((r) => ({
      productId: toText(r.product_id),
      productName: toText(r.product_name),
      value: toNumber(r.value),
    })),
  };
};
