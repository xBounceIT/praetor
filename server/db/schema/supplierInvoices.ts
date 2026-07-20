import { sql } from 'drizzle-orm';
import {
  check,
  date,
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
import { products } from './products.ts';
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
    // RESTRICT (not CASCADE): deleting a supplier must not silently destroy supplier invoices
    // (financial documents). Callers must remove invoices explicitly before deleting the supplier.
    supplierId: varchar('supplier_id', { length: 50 })
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
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

export const supplierInvoiceItems = pgTable(
  'supplier_invoice_items',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    invoiceId: varchar('invoice_id', { length: 100 })
      .notNull()
      .references(() => supplierInvoices.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    productId: varchar('product_id', { length: 50 }).references(() => products.id, {
      onDelete: 'set null',
    }),
    description: varchar('description', { length: 255 }).notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1'),
    unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull().default('0'),
    discount: numeric('discount', { precision: 5, scale: 2 }).default('0'),
    // Canonical duration in months, carried over from the supplier order for API/data compatibility.
    durationMonths: integer('duration_months').notNull().default(1),
    // Display unit for `durationMonths`: pricing uses its displayed numeric value; 'na' is neutral.
    durationUnit: text('duration_unit').notNull().default('months'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    pricingSemanticsVersion: integer('pricing_semantics_version')
      .$type<PricingSemanticsVersion>()
      .notNull()
      .default(2),
  },
  (table) => [
    index('idx_supplier_invoice_items_invoice_id').on(table.invoiceId),
    check('chk_supplier_invoice_items_duration_months', sql`${table.durationMonths} >= 1`),
    check(
      'chk_supplier_invoice_items_duration_unit',
      sql`${table.durationUnit} IN ('months', 'years', 'na')`,
    ),
    check(
      'chk_supplier_invoice_items_pricing_semantics_version',
      sql`${table.pricingSemanticsVersion} IN (1, 2)`,
    ),
  ],
);
