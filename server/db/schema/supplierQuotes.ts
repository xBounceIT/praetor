import { sql } from 'drizzle-orm';
import { date, index, numeric, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { suppliers } from './suppliers.ts';

// Status CHECK ('received', 'approved', 'rejected', 'draft', 'sent', 'accepted', 'denied')
// is enforced at the DB level. The route layer normalizes legacy values ('received' → 'sent',
// 'approved' → 'accepted', 'rejected' → 'denied') on the way out.
export const supplierQuotes = pgTable(
  'supplier_quotes',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    supplierId: varchar('supplier_id', { length: 50 })
      .notNull()
      .references(() => suppliers.id, { onDelete: 'cascade' }),
    supplierName: varchar('supplier_name', { length: 255 }).notNull(),
    paymentTerms: varchar('payment_terms', { length: 20 }).notNull().default('immediate'),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    expirationDate: date('expiration_date', { mode: 'string' }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_supplier_quotes_supplier_id').on(table.supplierId),
    index('idx_supplier_quotes_status').on(table.status),
    index('idx_supplier_quotes_created_at').on(table.createdAt),
  ],
);

// `product_id` runtime FK to `products(id) ON DELETE RESTRICT` (un-modeled — products is in
// Tier 5).
export const supplierQuoteItems = pgTable(
  'supplier_quote_items',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    quoteId: varchar('quote_id', { length: 100 })
      .notNull()
      .references(() => supplierQuotes.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    productId: varchar('product_id', { length: 50 }),
    productName: varchar('product_name', { length: 255 }).notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1'),
    unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull().default('0'),
    note: text('note'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    unitType: varchar('unit_type', { length: 10 }).default('hours'),
  },
  (table) => [index('idx_supplier_quote_items_quote_id').on(table.quoteId)],
);
