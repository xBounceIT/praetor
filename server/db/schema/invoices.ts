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
import { sales } from './sales.ts';

// The `id` column is VARCHAR(100) — wider than typical entity IDs because it follows the
// `INV-{year}-{seq}` pattern.
export const invoices = pgTable(
  'invoices',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    linkedSaleId: varchar('linked_sale_id', { length: 100 }).references(() => sales.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    clientId: varchar('client_id', { length: 50 })
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    clientName: varchar('client_name', { length: 255 }).notNull(),
    issueDate: date('issue_date', { mode: 'string' }).notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    subtotal: numeric('subtotal', { precision: 12, scale: 2 }).notNull().default('0'),
    total: numeric('total', { precision: 12, scale: 2 }).notNull().default('0'),
    amountPaid: numeric('amount_paid', { precision: 12, scale: 2 }).notNull().default('0'),
    notes: text('notes'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_invoices_client_id').on(table.clientId),
    index('idx_invoices_status').on(table.status),
    index('idx_invoices_issue_date').on(table.issueDate),
    check(
      'invoices_status_check',
      sql`${table.status} IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')`,
    ),
  ],
);

export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    invoiceId: varchar('invoice_id', { length: 100 })
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    productId: varchar('product_id', { length: 50 }).references(() => products.id, {
      onDelete: 'set null',
    }),
    description: varchar('description', { length: 255 }).notNull(),
    unitOfMeasure: varchar('unit_of_measure', { length: 20 }).notNull().default('unit'),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1'),
    unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull().default('0'),
    discount: numeric('discount', { precision: 5, scale: 2 }).default('0'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_invoice_items_invoice_id').on(table.invoiceId)],
);
