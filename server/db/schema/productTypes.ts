import { sql } from 'drizzle-orm';
import { check, index, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import type { CostUnit } from '../../utils/cost-unit.ts';

export const productTypes = pgTable(
  'product_types',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    name: varchar('name', { length: 50 }).notNull(),
    costUnit: varchar('cost_unit', { length: 20 }).$type<CostUnit>().notNull().default('unit'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_product_types_name').on(table.name),
    uniqueIndex('product_types_name_unique').on(sql`lower(${table.name})`),
    check('product_types_cost_unit_check', sql`${table.costUnit} IN ('unit', 'hours')`),
  ],
);
