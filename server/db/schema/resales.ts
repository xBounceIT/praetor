import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sales } from './sales.ts';
import { supplierSales } from './supplierSales.ts';

export const RESALE_BILLING_FREQUENCIES = ['monthly', 'quarterly', 'annual', 'one_time'] as const;
export type ResaleBillingFrequency = (typeof RESALE_BILLING_FREQUENCIES)[number];

export const resaleCategories = pgTable(
  'resale_categories',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex('idx_resale_categories_name_unique').on(table.name)],
);

export const resales = pgTable(
  'resales',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    clientOrderId: varchar('client_order_id', { length: 100 })
      .notNull()
      .references(() => sales.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    supplierOrderId: varchar('supplier_order_id', { length: 100 })
      .notNull()
      .references(() => supplierSales.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    dueDate: date('due_date', { mode: 'string' }),
    notes: text('notes'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_resales_client_order_id').on(table.clientOrderId),
    index('idx_resales_supplier_order_id').on(table.supplierOrderId),
    uniqueIndex('idx_resales_client_supplier_order_unique').on(
      table.clientOrderId,
      table.supplierOrderId,
    ),
  ],
);

export const resaleActivities = pgTable(
  'resale_activities',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    resaleId: varchar('resale_id', { length: 50 })
      .notNull()
      .references(() => resales.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    billingFrequency: varchar('billing_frequency', { length: 20 })
      .$type<ResaleBillingFrequency>()
      .notNull()
      .default('one_time'),
    categoryId: varchar('category_id', { length: 50 })
      .notNull()
      .references(() => resaleCategories.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    cost: numeric('cost', { precision: 15, scale: 2 }).notNull().default('0'),
    revenue: numeric('revenue', { precision: 15, scale: 2 }).notNull().default('0'),
    released: boolean('released').notNull().default(false),
    dueDate: date('due_date', { mode: 'string' }),
    notes: text('notes'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_resale_activities_resale_id').on(table.resaleId),
    index('idx_resale_activities_category_id').on(table.categoryId),
    check(
      'resale_activities_billing_frequency_check',
      sql`${table.billingFrequency} IN ('monthly', 'quarterly', 'annual', 'one_time')`,
    ),
    check('resale_activities_cost_non_negative_check', sql`${table.cost} >= 0`),
    check('resale_activities_revenue_non_negative_check', sql`${table.revenue} >= 0`),
  ],
);
