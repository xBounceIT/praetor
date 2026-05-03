import { sql } from 'drizzle-orm';
import { boolean, date, numeric, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { defineUserAssignmentTable } from './_userAssignmentTable.ts';
import { projects } from './projects.ts';

export const tasks = pgTable('tasks', {
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
});

export const userTasks = defineUserAssignmentTable({
  tableName: 'user_tasks',
  fkColumnName: 'task_id',
  fkColumnKey: 'taskId',
  fkTarget: () => tasks.id,
  checkName: 'user_tasks_assignment_source_check',
});
