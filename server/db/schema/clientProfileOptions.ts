import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export const clientProfileOptions = pgTable(
  'client_profile_options',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    category: varchar('category', { length: 50 }).notNull(),
    value: varchar('value', { length: 120 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    // Functional unique index: dedup is case-insensitive on `value`. Matches the
    // existing `idx_client_profile_options_category_value_unique` in schema.sql.
    uniqueIndex('idx_client_profile_options_category_value_unique').on(
      table.category,
      sql`LOWER(${table.value})`,
    ),
    index('idx_client_profile_options_category_sort').on(
      table.category,
      table.sortOrder,
      table.value,
    ),
    check(
      'chk_client_profile_options_category',
      sql`${table.category} IN ('sector', 'numberOfEmployees', 'revenue', 'officeCountRange')`,
    ),
  ],
);
