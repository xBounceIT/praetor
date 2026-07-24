import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

// Legacy rows may contain partially shaped JSON; the repository sanitizes every
// contact before exposing it through the API.
export type StoredSupplierContact = {
  fullName?: string;
  name?: string;
  role?: string;
  email?: string;
  phone?: string;
};

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
    contacts: jsonb('contacts').$type<StoredSupplierContact[]>().default(sql`'[]'::jsonb`),
    address: text('address'),
    vatNumber: varchar('vat_number', { length: 50 }),
    taxCode: varchar('tax_code', { length: 50 }),
    paymentTerms: text('payment_terms'),
    notes: text('notes'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_suppliers_name').on(table.name),
    uniqueIndex('idx_suppliers_supplier_code_unique')
      .on(sql`LOWER(${table.supplierCode})`)
      .where(sql`${table.supplierCode} IS NOT NULL AND ${table.supplierCode} <> ''`),
  ],
);
