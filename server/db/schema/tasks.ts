import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

// Project work items. `project_id` has a runtime FK to `projects(id)` (not modeled in TS yet)
// — same carve-out as `notifications.user_id`. CHECK constraint on `recurrence_pattern` is
// managed via the historical `add_*` migrations and stays at the DB level.
export const tasks = pgTable('tasks', {
  id: varchar('id', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  projectId: varchar('project_id', { length: 50 }).notNull(),
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

// Many-to-many users ↔ tasks. `user_id` has a runtime FK to `users(id)` (not modeled in TS yet).
// CHECK constraint on `assignment_source` is enforced at the DB level.
export const userTasks = pgTable(
  'user_tasks',
  {
    userId: varchar('user_id', { length: 50 }).notNull(),
    taskId: varchar('task_id', { length: 50 })
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    assignmentSource: varchar('assignment_source', { length: 20 }).notNull().default('manual'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.userId, table.taskId] })],
);
