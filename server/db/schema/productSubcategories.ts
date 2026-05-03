import { sql } from 'drizzle-orm';
import { index, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { productCategories } from './productCategories.ts';

export const productSubcategories = pgTable(
  'internal_product_subcategories',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    categoryId: varchar('category_id', { length: 50 })
      .notNull()
      .references(() => productCategories.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_internal_product_subcategories_category_id').on(table.categoryId),
    uniqueIndex('internal_product_subcategories_category_id_name_key').on(
      table.categoryId,
      table.name,
    ),
  ],
);
