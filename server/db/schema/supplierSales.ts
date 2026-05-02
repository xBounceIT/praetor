import { sql } from 'drizzle-orm';
import { numeric, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

// `linked_quote_id` runtime FK to `supplier_quotes(id)` (un-modeled). `supplier_id` runtime
// FK to `suppliers(id)` (un-modeled). Status CHECK and discount_type CHECK enforced at DB
// level. Discount widened to DECIMAL(15, 2) by later ALTER. The `linked_offer_id` column
// was dropped by a later migration so it is intentionally not modeled.
export const supplierSales = pgTable('supplier_sales', {
  id: varchar('id', { length: 100 }).primaryKey(),
  linkedQuoteId: varchar('linked_quote_id', { length: 100 }),
  supplierId: varchar('supplier_id', { length: 50 }).notNull(),
  supplierName: varchar('supplier_name', { length: 255 }).notNull(),
  paymentTerms: varchar('payment_terms', { length: 20 }).notNull().default('immediate'),
  discount: numeric('discount', { precision: 15, scale: 2 }).notNull().default('0'),
  discountType: varchar('discount_type', { length: 10 }).notNull().default('percentage'),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  notes: text('notes'),
  createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// `product_id` runtime FK to `products(id) ON DELETE RESTRICT` (un-modeled). unit_price
// widened to DECIMAL(15, 2). `product_tax_rate` was dropped by a later migration.
export const supplierSaleItems = pgTable('supplier_sale_items', {
  id: varchar('id', { length: 50 }).primaryKey(),
  saleId: varchar('sale_id', { length: 100 })
    .notNull()
    .references(() => supplierSales.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
  productId: varchar('product_id', { length: 50 }),
  productName: varchar('product_name', { length: 255 }).notNull(),
  quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1'),
  unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull().default('0'),
  discount: numeric('discount', { precision: 5, scale: 2 }).default('0'),
  note: text('note'),
  createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
});
