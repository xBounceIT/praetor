import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import type { SupplierOrder, SupplierOrderItem } from '../../repositories/supplierOrdersRepo.ts';
import { supplierSales } from './supplierSales.ts';
import { users } from './users.ts';

// Versioned envelope so future schema changes on supplier_sales/supplier_sale_items can
// normalize old snapshots on read instead of being trapped by a frozen JSONB shape. Bump
// `schemaVersion` when the underlying domain types change in a non-additive way.
export interface SupplierOrderVersionSnapshot {
  schemaVersion: 1;
  order: SupplierOrder;
  items: SupplierOrderItem[];
}

export const supplierOrderVersions = pgTable(
  'supplier_order_versions',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    orderId: varchar('order_id', { length: 100 })
      .notNull()
      .references(() => supplierSales.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    snapshot: jsonb('snapshot').$type<SupplierOrderVersionSnapshot>().notNull(),
    reason: varchar('reason', { length: 20 }).notNull().default('update'),
    createdByUserId: varchar('created_by_user_id', { length: 50 }).references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_supplier_order_versions_order_id_created_at').on(
      table.orderId,
      table.createdAt.desc(),
    ),
    check('chk_supplier_order_versions_reason', sql`${table.reason} IN ('update', 'restore')`),
  ],
);
