import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
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
    // `order_id` → `sales.id` FK lives only in `schema.sql` (`ON DELETE SET NULL`, auto-named
    // `projects_order_id_fkey`); intentionally not modeled here so the projects schema doesn't
    // import from sales. `projectsRepo` still keys off the constraint name when handling FK
    // violation errors.
    orderId: varchar('order_id', { length: 100 }),
    billingType: varchar('billing_type', { length: 30 })
      .$type<'retainer' | 'time_and_materials'>()
      .notNull()
      .default('time_and_materials'),
    billingFrequency: varchar('billing_frequency', { length: 20 })
      .$type<'monthly' | 'one_time'>()
      .notNull()
      .default('monthly'),
  },
  (table) => [
    index('idx_projects_client_id').on(table.clientId),
    check(
      'projects_billing_type_check',
      sql`${table.billingType} IN ('retainer', 'time_and_materials')`,
    ),
    check(
      'projects_billing_frequency_check',
      sql`${table.billingFrequency} IN ('monthly', 'one_time')`,
    ),
    check(
      'projects_time_and_materials_monthly_check',
      sql`${table.billingType} != 'time_and_materials' OR ${table.billingFrequency} = 'monthly'`,
    ),
  ],
);

export const userProjects = defineUserAssignmentTable({
  tableName: 'user_projects',
  fkColumnKey: 'projectId',
  fkTarget: () => projects.id,
});
