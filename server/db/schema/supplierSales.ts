import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import type { UnitType } from '../../utils/unit-type.ts';
import { products } from './products.ts';
import { supplierQuotes } from './supplierQuotes.ts';
import { suppliers } from './suppliers.ts';

export const supplierSales = pgTable(
  'supplier_sales',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    linkedQuoteId: varchar('linked_quote_id', { length: 100 }).references(() => supplierQuotes.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    // RESTRICT (not CASCADE): deleting a supplier must not silently destroy supplier sales/orders
    // (financial documents). Callers must remove sales explicitly before deleting the supplier.
    supplierId: varchar('supplier_id', { length: 50 })
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    supplierName: varchar('supplier_name', { length: 255 }).notNull(),
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
    index('idx_supplier_sales_supplier_id').on(table.supplierId),
    index('idx_supplier_sales_status').on(table.status),
    index('idx_supplier_sales_linked_quote_id').on(table.linkedQuoteId),
    check('supplier_sales_status_check', sql`${table.status} IN ('draft', 'sent')`),
    check(
      'chk_supplier_sales_discount_type',
      sql`${table.discountType} IN ('percentage', 'currency')`,
    ),
  ],
);

export const supplierSaleItems = pgTable(
  'supplier_sale_items',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    saleId: varchar('sale_id', { length: 100 })
      .notNull()
      .references(() => supplierSales.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    productId: varchar('product_id', { length: 50 }).references(() => products.id, {
      onDelete: 'restrict',
    }),
    productName: varchar('product_name', { length: 255 }).notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1'),
    unitType: varchar('unit_type', { length: 10 }).$type<UnitType>().notNull().default('hours'),
    unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull().default('0'),
    discount: numeric('discount', { precision: 5, scale: 2 }).default('0'),
    // Rows created before precise supplier pricing rounded the discounted unit before applying
    // quantity/duration. Keep that calculation provenance without discarding gross price/discount.
    legacyDiscountRounding: boolean('legacy_discount_rounding').notNull().default(false),
    note: text('note'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    // Number of months the line runs (issue #776). Multiplies the line total alongside `quantity`;
    // carried over from the originating supplier quote so the order total matches the quote.
    // Defaults to 1 (one-off), which keeps legacy orders' totals identical.
    durationMonths: integer('duration_months').notNull().default(1),
    // Display unit for `durationMonths` (issue #776): 'months' (default), 'years', or 'na'. 'na'
    // (N/A) marks a line where duration does not apply and never multiplies (issue #775).
    durationUnit: text('duration_unit').notNull().default('months'),
  },
  (table) => [
    index('idx_supplier_sale_items_sale_id').on(table.saleId),
    check('chk_supplier_sale_items_unit_type', sql`${table.unitType} IN ('hours', 'days', 'unit')`),
    check('chk_supplier_sale_items_duration_months', sql`${table.durationMonths} >= 1`),
    check(
      'chk_supplier_sale_items_duration_unit',
      sql`${table.durationUnit} IN ('months', 'years', 'na')`,
    ),
  ],
);
