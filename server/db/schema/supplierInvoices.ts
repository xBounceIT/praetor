import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { supplierSales } from './supplierSales.ts';
import { suppliers } from './suppliers.ts';

export const supplierInvoices = pgTable(
  'supplier_invoices',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    linkedSaleId: varchar('linked_sale_id', { length: 100 }).references(() => supplierSales.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    supplierId: varchar('supplier_id', { length: 50 })
      .notNull()
      .references(() => suppliers.id, { onDelete: 'cascade' }),
    supplierName: varchar('supplier_name', { length: 255 }).notNull(),
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
    index('idx_supplier_invoices_supplier_id').on(table.supplierId),
    index('idx_supplier_invoices_status').on(table.status),
    index('idx_supplier_invoices_issue_date').on(table.issueDate),
    index('idx_supplier_invoices_linked_sale_id').on(table.linkedSaleId),
    uniqueIndex('idx_supplier_invoices_linked_sale_id_unique')
      .on(table.linkedSaleId)
      .where(sql`${table.linkedSaleId} IS NOT NULL`),
    check(
      'supplier_invoices_status_check',
      sql`${table.status} IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')`,
    ),
  ],
);

// `product_id` runtime FK to `products(id) ON DELETE SET NULL` (un-modeled — products is in
// Tier 5).
export const supplierInvoiceItems = pgTable(
  'supplier_invoice_items',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    invoiceId: varchar('invoice_id', { length: 100 })
      .notNull()
      .references(() => supplierInvoices.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    productId: varchar('product_id', { length: 50 }),
    description: varchar('description', { length: 255 }).notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1'),
    unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull().default('0'),
    discount: numeric('discount', { precision: 5, scale: 2 }).default('0'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_supplier_invoice_items_invoice_id').on(table.invoiceId)],
);
