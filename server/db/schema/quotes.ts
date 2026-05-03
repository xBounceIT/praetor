import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { clients } from './clients.ts';
import { products } from './products.ts';

export const quotes = pgTable(
  'quotes',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    clientId: varchar('client_id', { length: 50 })
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    clientName: varchar('client_name', { length: 255 }).notNull(),
    paymentTerms: varchar('payment_terms', { length: 20 }).notNull().default('immediate'),
    discount: numeric('discount', { precision: 15, scale: 2 }).notNull().default('0'),
    discountType: varchar('discount_type', { length: 10 })
      .$type<'percentage' | 'currency'>()
      .notNull()
      .default('percentage'),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    expirationDate: date('expiration_date', { mode: 'string' }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_quotes_client_id').on(table.clientId),
    index('idx_quotes_status').on(table.status),
    index('idx_quotes_created_at').on(table.createdAt),
    check(
      'quotes_status_check',
      sql`${table.status} IN ('quoted', 'confirmed', 'draft', 'sent', 'accepted', 'denied')`,
    ),
    check('chk_quotes_discount_type', sql`${table.discountType} IN ('percentage', 'currency')`),
  ],
);

// `product_id` is nullable: items can be sourced from a supplier_quote_item via
// `supplier_quote_item_id` instead of pointing at a product. `supplier_quote_*` columns
// track items copied from supplier quotes.
export const quoteItems = pgTable(
  'quote_items',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    quoteId: varchar('quote_id', { length: 100 })
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    productId: varchar('product_id', { length: 50 }).references(() => products.id, {
      onDelete: 'restrict',
    }),
    productName: varchar('product_name', { length: 255 }).notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1'),
    unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull().default('0'),
    productCost: numeric('product_cost', { precision: 15, scale: 2 }).notNull().default('0'),
    productMolPercentage: numeric('product_mol_percentage', { precision: 5, scale: 2 }),
    supplierQuoteId: varchar('supplier_quote_id', { length: 100 }),
    supplierQuoteItemId: varchar('supplier_quote_item_id', { length: 50 }),
    supplierQuoteSupplierName: varchar('supplier_quote_supplier_name', { length: 255 }),
    supplierQuoteUnitPrice: numeric('supplier_quote_unit_price', { precision: 15, scale: 2 }),
    discount: numeric('discount', { precision: 5, scale: 2 }).default('0'),
    note: text('note'),
    unitType: varchar('unit_type', { length: 10 }).default('hours'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_quote_items_quote_id').on(table.quoteId),
    check('chk_quote_items_unit_type', sql`${table.unitType} IN ('hours', 'days', 'unit')`),
  ],
);
