import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import type { PricingSemanticsVersion } from '../../utils/pricing-semantics.ts';
import { clients } from './clients.ts';
import { customerOffers } from './customerOffers.ts';
import { products } from './products.ts';
import { quotes } from './quotes.ts';

export const sales = pgTable(
  'sales',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    linkedQuoteId: varchar('linked_quote_id', { length: 100 }).references(() => quotes.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    linkedOfferId: varchar('linked_offer_id', { length: 100 }).references(() => customerOffers.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    // RESTRICT (not CASCADE): deleting a client must not silently destroy orders/sales
    // (financial documents). Callers must remove sales explicitly before deleting the client.
    clientId: varchar('client_id', { length: 50 })
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    clientName: varchar('client_name', { length: 255 }).notNull(),
    paymentTerms: varchar('payment_terms', { length: 20 }).notNull().default('immediate'),
    discount: numeric('discount', { precision: 15, scale: 2 }).notNull().default('0'),
    discountType: varchar('discount_type', { length: 10 })
      .$type<'percentage' | 'currency'>()
      .notNull()
      .default('percentage'),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    notes: text('notes'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_sales_client_id').on(table.clientId),
    index('idx_sales_status').on(table.status),
    index('idx_sales_linked_quote_id').on(table.linkedQuoteId),
    index('idx_sales_linked_offer_id').on(table.linkedOfferId),
    // Partial unique index: enforces 1-to-1 sale ↔ offer when an offer is linked.
    uniqueIndex('idx_sales_linked_offer_id_unique')
      .on(table.linkedOfferId)
      .where(sql`${table.linkedOfferId} IS NOT NULL`),
    index('idx_sales_created_at').on(table.createdAt),
    check('sales_status_check', sql`${table.status} IN ('draft', 'confirmed', 'denied')`),
    check('chk_sales_discount_type', sql`${table.discountType} IN ('percentage', 'currency')`),
  ],
);

// `supplier_*` columns track items copied from supplier quotes / linked to supplier sales.
// `product_id` is nullable: a line sourced from a supplier-quote item (tracked via
// `supplier_quote_item_id`) need not point at a catalog product, mirroring quote_items /
// customer_offer_items / invoice_items. Without this, converting an offer that carries such a
// free-form supplier line into an order failed (issue #783).
export const saleItems = pgTable(
  'sale_items',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    saleId: varchar('sale_id', { length: 100 })
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    productId: varchar('product_id', { length: 50 }).references(() => products.id, {
      onDelete: 'restrict',
    }),
    productName: varchar('product_name', { length: 255 }).notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1'),
    unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull().default('0'),
    productCost: numeric('product_cost', { precision: 15, scale: 2 }).notNull().default('0'),
    productMolPercentage: numeric('product_mol_percentage', { precision: 5, scale: 2 }),
    discount: numeric('discount', { precision: 5, scale: 2 }).default('0'),
    unitType: varchar('unit_type', { length: 10 }).default('hours'),
    note: text('note'),
    supplierQuoteId: varchar('supplier_quote_id', { length: 100 }),
    supplierQuoteItemId: varchar('supplier_quote_item_id', { length: 50 }),
    supplierQuoteSupplierName: varchar('supplier_quote_supplier_name', { length: 255 }),
    supplierQuoteUnitPrice: numeric('supplier_quote_unit_price', { precision: 15, scale: 2 }),
    supplierSaleId: varchar('supplier_sale_id', { length: 100 }),
    supplierSaleItemId: varchar('supplier_sale_item_id', { length: 50 }),
    supplierSaleSupplierName: varchar('supplier_sale_supplier_name', { length: 255 }),
    // Canonical whole months retained for API/data compatibility; defaults to a one-off item.
    durationMonths: integer('duration_months').notNull().default(1),
    // Unit shown beside the duration: pricing uses that displayed value and 'na' is neutral.
    durationUnit: text('duration_unit').notNull().default('months'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    pricingSemanticsVersion: integer('pricing_semantics_version')
      .$type<PricingSemanticsVersion>()
      .notNull()
      .default(1),
  },
  (table) => [
    index('idx_sale_items_sale_id').on(table.saleId),
    index('idx_sale_items_supplier_sale_id').on(table.supplierSaleId),
    check('chk_sale_items_unit_type', sql`${table.unitType} IN ('hours', 'days', 'unit')`),
    check('chk_sale_items_duration_months', sql`${table.durationMonths} >= 1`),
    check('chk_sale_items_duration_unit', sql`${table.durationUnit} IN ('months', 'years', 'na')`),
    check(
      'chk_sale_items_pricing_semantics_version',
      sql`${table.pricingSemanticsVersion} IN (1, 2)`,
    ),
  ],
);
