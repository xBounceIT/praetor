import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import type { ClientOrder, ClientOrderItem } from '../../repositories/clientsOrdersRepo.ts';
import { sales } from './sales.ts';
import { users } from './users.ts';

// Bump `schemaVersion` when ClientOrder/ClientOrderItem change in a non-additive way so
// readers can normalize old JSONB snapshots instead of being trapped by a frozen shape.
export interface OrderVersionSnapshot {
  schemaVersion: 1;
  order: Omit<ClientOrder, 'linkedQuoteId' | 'linkedOfferId'>;
  items: ClientOrderItem[];
}

export const orderVersions = pgTable(
  'order_versions',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    orderId: varchar('order_id', { length: 100 })
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    snapshot: jsonb('snapshot').$type<OrderVersionSnapshot>().notNull(),
    reason: varchar('reason', { length: 20 }).notNull().default('update'),
    createdByUserId: varchar('created_by_user_id', { length: 50 }).references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_order_versions_order_id_created_at').on(table.orderId, table.createdAt.desc()),
    check('chk_order_versions_reason', sql`${table.reason} IN ('update', 'restore')`),
  ],
);
