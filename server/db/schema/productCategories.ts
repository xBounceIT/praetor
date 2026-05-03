import { sql } from 'drizzle-orm';
import { index, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import type { CostUnit } from '../../utils/cost-unit.ts';

export const productCategories = pgTable(
  'internal_product_categories',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    type: varchar('type', { length: 20 }).notNull(),
    costUnit: varchar('cost_unit', { length: 20 }).$type<CostUnit>().notNull().default('unit'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_internal_product_categories_type').on(table.type)],
);
