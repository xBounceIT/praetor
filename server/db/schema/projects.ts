import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

// FK references on `clientId` (→ clients, modeled in PR 6) and `orderId` (→ sales, already
// modeled) are intentionally omitted: per the Phase 3 migration plan, FKs to tables not yet
// modeled (or modeled in the same tier) stay declared only in `schema.sql`. The retroactive
// `.references(...)` backfill is a deferred follow-up.
export const projects = pgTable(
  'projects',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    clientId: varchar('client_id', { length: 50 }).notNull(),
    color: varchar('color', { length: 20 }).notNull().default('#3b82f6'),
    description: text('description'),
    isDisabled: boolean('is_disabled').default(false),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    orderId: varchar('order_id', { length: 100 }),
  },
  (table) => [index('idx_projects_client_id').on(table.clientId)],
);
