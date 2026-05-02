import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const suppliers = pgTable(
  'suppliers',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    isDisabled: boolean('is_disabled').default(false),
    supplierCode: varchar('supplier_code', { length: 50 }),
    contactName: varchar('contact_name', { length: 255 }),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 50 }),
    address: text('address'),
    vatNumber: varchar('vat_number', { length: 50 }),
    taxCode: varchar('tax_code', { length: 50 }),
    paymentTerms: text('payment_terms'),
    notes: text('notes'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_suppliers_name').on(table.name)],
);
