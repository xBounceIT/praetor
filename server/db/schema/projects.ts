import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { defineUserAssignmentTable } from './_userAssignmentTable.ts';
import { clients } from './clients.ts';

export const projects = pgTable(
  'projects',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    clientId: varchar('client_id', { length: 50 })
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    color: varchar('color', { length: 20 }).notNull().default('#3b82f6'),
    description: text('description'),
    isDisabled: boolean('is_disabled').default(false),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    // `order_id` → `sales.id` FK (`ON DELETE SET NULL`, auto-named `projects_order_id_fkey`)
    // is created out-of-band by `schema.sql:1116` on legacy bootstraps and by
    // `migrations/0025_align_schema_sql_parity.sql` on Drizzle-only bootstraps; intentionally
    // not modeled here so the projects schema doesn't import from sales. `projectsRepo` still
    // keys off the constraint name when handling FK violation errors.
    orderId: varchar('order_id', { length: 100 }),
  },
  (table) => [index('idx_projects_client_id').on(table.clientId)],
);

export const userProjects = defineUserAssignmentTable({
  tableName: 'user_projects',
  fkColumnKey: 'projectId',
  fkTarget: () => projects.id,
});
