import { sql } from 'drizzle-orm';
import { index, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import type { CostUnit } from '../../utils/cost-unit.ts';

export const productTypes = pgTable(
  'product_types',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    name: varchar('name', { length: 50 }).notNull().unique(),
    costUnit: varchar('cost_unit', { length: 20 }).$type<CostUnit>().notNull().default('unit'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_product_types_name').on(table.name)],
);
