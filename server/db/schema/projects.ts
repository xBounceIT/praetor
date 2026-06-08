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
  varchar,
} from 'drizzle-orm/pg-core';
import { defineUserAssignmentTable } from './_userAssignmentTable.ts';
import { clients } from './clients.ts';
import { customerOffers } from './customerOffers.ts';
import { sales } from './sales.ts';

export const projects = pgTable(
  'projects',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    clientId: varchar('client_id', { length: 50 })
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    description: text('description'),
    isDisabled: boolean('is_disabled').default(false),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    // `order_id` → `sales.id` FK. Historical schema.sql created it auto-named as
    // `projects_order_id_fkey`; the Drizzle migration renames it to the canonical
    // `projects_order_id_sales_id_fk`. `projectsRepo` translates both names into a
    // ForeignKeyError('Linked order') so installations mid-migration stay covered.
    // `onUpdate: cascade` matches the rest of the `sales.id` FK chain (sale_items,
    // invoices, order_versions) so renaming an order ID via PUT /api/clients-orders/:id
    // doesn't fail when a project is linked.
    orderId: varchar('order_id', { length: 100 }).references(() => sales.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    offerId: varchar('offer_id', { length: 100 }).references(() => customerOffers.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    revenue: numeric('revenue', { precision: 15, scale: 2 }),
    billingType: varchar('billing_type', { length: 30 })
      .$type<'retainer' | 'time_and_materials'>()
      .notNull()
      .default('time_and_materials'),
    billingFrequency: varchar('billing_frequency', { length: 20 })
      .$type<'monthly' | 'one_time'>()
      .notNull()
      .default('monthly'),
    // `tipo` (issue #784): mandatory active/passive classification. Existing rows are
    // defaulted to 'attivo' by the rollout migration; `tipo_confirmed` stays false until a
    // user explicitly chooses a value, so the edit form can force a deliberate first choice.
    tipo: varchar('tipo', { length: 20 }).$type<'attivo' | 'passivo'>().notNull().default('attivo'),
    tipoConfirmed: boolean('tipo_confirmed').notNull().default(false),
  },
  (table) => [
    index('idx_projects_client_id').on(table.clientId),
    check(
      'projects_billing_type_check',
      sql`${table.billingType} IN ('retainer', 'time_and_materials')`,
    ),
    check('projects_tipo_check', sql`${table.tipo} IN ('attivo', 'passivo')`),
    check(
      'projects_billing_frequency_check',
      sql`${table.billingFrequency} IN ('monthly', 'one_time')`,
    ),
    check(
      'projects_time_and_materials_monthly_check',
      sql`${table.billingType} != 'time_and_materials' OR ${table.billingFrequency} = 'monthly'`,
    ),
    check(
      'projects_date_range_check',
      sql`${table.startDate} IS NULL OR ${table.endDate} IS NULL OR ${table.startDate} <= ${table.endDate}`,
    ),
    check(
      'projects_revenue_non_negative_check',
      sql`${table.revenue} IS NULL OR ${table.revenue} >= 0`,
    ),
  ],
);

export const userProjects = defineUserAssignmentTable({
  tableName: 'user_projects',
  fkColumnKey: 'projectId',
  fkTarget: () => projects.id,
});
