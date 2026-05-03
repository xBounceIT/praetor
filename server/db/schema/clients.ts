import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.ts';

// Stored shape of a contact in the `contacts` JSONB column. Looser than the domain
// `ClientContact` type because legacy rows may have varying field presence; the repo's
// `parseContactsFromDb` helper sanitizes on read.
export type StoredContact = {
  fullName?: string;
  name?: string;
  role?: string;
  email?: string;
  phone?: string;
};

export const clients = pgTable(
  'clients',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    isDisabled: boolean('is_disabled').default(false),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    type: varchar('type', { length: 20 }).default('company'),
    contactName: varchar('contact_name', { length: 255 }),
    clientCode: varchar('client_code', { length: 50 }),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 50 }),
    address: text('address'),
    description: text('description'),
    atecoCode: varchar('ateco_code', { length: 50 }),
    website: varchar('website', { length: 255 }),
    sector: varchar('sector', { length: 120 }),
    numberOfEmployees: varchar('number_of_employees', { length: 120 }),
    revenue: varchar('revenue', { length: 120 }),
    fiscalCode: varchar('fiscal_code', { length: 50 }),
    officeCountRange: varchar('office_count_range', { length: 120 }),
    contacts: jsonb('contacts').$type<StoredContact[]>().default(sql`'[]'::jsonb`),
    addressCountry: varchar('address_country', { length: 100 }),
    addressState: varchar('address_state', { length: 100 }),
    addressCap: varchar('address_cap', { length: 20 }),
    addressProvince: varchar('address_province', { length: 100 }),
    addressCivicNumber: varchar('address_civic_number', { length: 30 }),
    addressLine: text('address_line'),
  },
  (table) => ({
    fiscalCodeUnique: uniqueIndex('idx_clients_fiscal_code_unique')
      .on(sql`LOWER(${table.fiscalCode})`)
      .where(sql`${table.fiscalCode} IS NOT NULL AND ${table.fiscalCode} <> ''`),
    clientCodeUnique: uniqueIndex('idx_clients_client_code_unique')
      .on(table.clientCode)
      .where(sql`${table.clientCode} IS NOT NULL AND ${table.clientCode} <> ''`),
  }),
);

// Many-to-many users ↔ clients with assignment provenance. `assignment_source` distinguishes
// manual assignments from automatic ones (top-manager auto-assign, project-cascade) so the
// sync logic in `userAssignmentsRepo` can preserve manual edits while reconciling auto rows.
export const userClients = pgTable(
  'user_clients',
  {
    userId: varchar('user_id', { length: 50 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientId: varchar('client_id', { length: 50 })
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    assignmentSource: varchar('assignment_source', { length: 20 })
      .$type<'manual' | 'top_manager_auto' | 'project_cascade'>()
      .notNull()
      .default('manual'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.clientId] }),
    check(
      'user_clients_assignment_source_check',
      sql`${table.assignmentSource} IN ('manual', 'top_manager_auto', 'project_cascade')`,
    ),
  ],
);
