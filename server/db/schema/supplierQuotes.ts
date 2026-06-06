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
import { suppliers } from './suppliers.ts';

// The route layer normalizes legacy status values ('received' → 'sent', 'approved' → 'accepted',
// 'rejected' → 'denied') on the way out, but the DB still accepts both forms.
export const supplierQuotes = pgTable(
  'supplier_quotes',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    // RESTRICT (not CASCADE): deleting a supplier must not silently destroy supplier quotes
    // (financial documents). Callers must remove quotes explicitly before deleting the supplier.
    supplierId: varchar('supplier_id', { length: 50 })
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    supplierName: varchar('supplier_name', { length: 255 }).notNull(),
    // Optional customer association (issue #759). Nullable: a supplier quote with no linked
    // customer is a valid state. RESTRICT so a client with linked supplier quotes can't be
    // silently deleted, mirroring the supplier FK above. `client_name` is denormalized for
    // display, matching the `quotes` table convention.
    clientId: varchar('client_id', { length: 50 }).references(() => clients.id, {
      onDelete: 'restrict',
    }),
    clientName: varchar('client_name', { length: 255 }),
    paymentTerms: varchar('payment_terms', { length: 20 }).notNull().default('immediate'),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    expirationDate: date('expiration_date', { mode: 'string' }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_supplier_quotes_supplier_id').on(table.supplierId),
    index('idx_supplier_quotes_client_id').on(table.clientId),
    index('idx_supplier_quotes_status').on(table.status),
    index('idx_supplier_quotes_created_at').on(table.createdAt),
    check(
      'supplier_quotes_status_check',
      sql`${table.status} IN ('received', 'approved', 'rejected', 'draft', 'sent', 'accepted', 'denied')`,
    ),
  ],
);

// `product_id` is nullable: supplier quotes can carry free-form items not pinned to a catalog
// product.
export const supplierQuoteItems = pgTable(
  'supplier_quote_items',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    quoteId: varchar('quote_id', { length: 100 })
      .notNull()
      .references(() => supplierQuotes.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    productId: varchar('product_id', { length: 50 }).references(() => products.id, {
      onDelete: 'restrict',
    }),
    productName: varchar('product_name', { length: 255 }).notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1'),
    unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull().default('0'),
    note: text('note'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    unitType: varchar('unit_type', { length: 10 }).default('hours'),
  },
  (table) => [
    index('idx_supplier_quote_items_quote_id').on(table.quoteId),
    // NULL passes a PG CHECK by default (comparison yields NULL, not FALSE), so this allows
    // legacy rows with null unit_type while constraining new writes to the enum.
    check(
      'chk_supplier_quote_items_unit_type',
      sql`${table.unitType} IN ('hours', 'days', 'unit')`,
    ),
  ],
);
