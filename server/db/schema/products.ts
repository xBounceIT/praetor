import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import type { CostUnit } from '../../utils/cost-unit.ts';
import { suppliers } from './suppliers.ts';

export const products = pgTable(
  'products',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    productCode: varchar('product_code', { length: 50 }).notNull(),
    costo: numeric('costo', { precision: 15, scale: 2 }).notNull().default('0'),
    molPercentage: numeric('mol_percentage', { precision: 5, scale: 2 }).notNull().default('0'),
    costUnit: varchar('cost_unit', { length: 20 }).$type<CostUnit>().notNull().default('unit'),
    category: varchar('category', { length: 100 }),
    type: varchar('type', { length: 20 }).notNull().default('item'),
    description: text('description'),
    subcategory: varchar('subcategory', { length: 100 }),
    isDisabled: boolean('is_disabled').default(false),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    supplierId: varchar('supplier_id', { length: 50 }).references(() => suppliers.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    index('idx_products_name').on(table.name),
    uniqueIndex('idx_products_name_unique').on(table.name),
    uniqueIndex('idx_products_product_code_unique').on(table.productCode),
    index('idx_products_supplier_id').on(table.supplierId),
    index('idx_products_type').on(table.type),
  ],
);
