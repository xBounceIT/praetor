import { createChildLogger, serializeError } from '../utils/logger.ts';
import { query } from './index.ts';

const logger = createChildLogger({ module: 'db:add_unique_downstream_links' });

type DuplicateLinkRow = {
  sourceId: string;
  duplicateCount: string | number;
};

const formatDuplicateRows = (rows: DuplicateLinkRow[]) =>
  rows.map((row) => `${row.sourceId} (${row.duplicateCount})`).join(', ');

export async function migrate() {
  logger.info('Ensuring unique downstream link indexes');

  try {
    const duplicateSalesOfferLinksResult = await query(
      `SELECT linked_offer_id as "sourceId", COUNT(*) as "duplicateCount"
       FROM sales
       WHERE linked_offer_id IS NOT NULL
       GROUP BY linked_offer_id
       HAVING COUNT(*) > 1
       ORDER BY linked_offer_id`,
    );
    const duplicateSalesOfferLinks = duplicateSalesOfferLinksResult.rows as DuplicateLinkRow[];

    const duplicateSupplierInvoiceLinksResult = await query(
      `SELECT linked_sale_id as "sourceId", COUNT(*) as "duplicateCount"
       FROM supplier_invoices
       WHERE linked_sale_id IS NOT NULL
       GROUP BY linked_sale_id
       HAVING COUNT(*) > 1
       ORDER BY linked_sale_id`,
    );
    const duplicateSupplierInvoiceLinks =
      duplicateSupplierInvoiceLinksResult.rows as DuplicateLinkRow[];

    const duplicateSections: string[] = [];
    if (duplicateSalesOfferLinks.length > 0) {
      duplicateSections.push(
        `sales.linked_offer_id duplicates: ${formatDuplicateRows(duplicateSalesOfferLinks)}`,
      );
    }
    if (duplicateSupplierInvoiceLinks.length > 0) {
      duplicateSections.push(
        `supplier_invoices.linked_sale_id duplicates: ${formatDuplicateRows(duplicateSupplierInvoiceLinks)}`,
      );
    }

    if (duplicateSections.length > 0) {
      throw new Error(
        `Cannot add unique downstream link indexes until duplicates are cleaned up manually. ${duplicateSections.join('; ')}`,
      );
    }

    await query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_linked_offer_id_unique
       ON sales(linked_offer_id)
       WHERE linked_offer_id IS NOT NULL`,
    );
    await query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_invoices_linked_sale_id_unique
       ON supplier_invoices(linked_sale_id)
       WHERE linked_sale_id IS NOT NULL`,
    );

    logger.info('Unique downstream link indexes ensured');
  } catch (err) {
    logger.error({ err: serializeError(err) }, 'Downstream link uniqueness migration failed');
    throw err;
  }
}
