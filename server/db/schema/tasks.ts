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
import { projects } from './projects.ts';

export const tasks = pgTable(
  'tasks',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    projectId: varchar('project_id', { length: 50 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    description: text('description'),
    isRecurring: boolean('is_recurring').default(false),
    recurrencePattern: varchar('recurrence_pattern', { length: 50 }),
    recurrenceStart: date('recurrence_start', { mode: 'string' }),
    recurrenceEnd: date('recurrence_end', { mode: 'string' }),
    recurrenceDuration: numeric('recurrence_duration', { precision: 10, scale: 2 }).default('0'),
    expectedEffort: numeric('expected_effort', { precision: 10, scale: 2 }).default('0'),
    revenue: numeric('revenue', { precision: 15, scale: 2 }).default('0'),
    notes: text('notes'),
    isDisabled: boolean('is_disabled').default(false),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    billingType: varchar('billing_type', { length: 30 })
      .$type<'retainer' | 'time_and_materials'>()
      .notNull()
      .default('time_and_materials'),
    billingFrequency: varchar('billing_frequency', { length: 20 })
      .$type<'monthly' | 'one_time'>()
      .notNull()
      .default('monthly'),
    monthlyEffort: numeric('monthly_effort', { precision: 10, scale: 2 }).default('0'),
  },
  (table) => [
    index('idx_tasks_project_id').on(table.projectId),
    check(
      'tasks_billing_type_check',
      sql`${table.billingType} IN ('retainer', 'time_and_materials')`,
    ),
    check(
      'tasks_billing_frequency_check',
      sql`${table.billingFrequency} IN ('monthly', 'one_time')`,
    ),
    check(
      'tasks_time_and_materials_monthly_check',
      sql`${table.billingType} != 'time_and_materials' OR ${table.billingFrequency} = 'monthly'`,
    ),
  ],
);

export const userTasks = defineUserAssignmentTable({
  tableName: 'user_tasks',
  fkColumnKey: 'taskId',
  fkTarget: () => tasks.id,
});
