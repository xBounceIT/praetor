import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { projects } from './projects.ts';
import { users } from './users.ts';

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

// Many-to-many users ↔ tasks with assignment provenance. Mirrors `userClients` and
// `userProjects`.
export const userTasks = pgTable(
  'user_tasks',
  {
    userId: varchar('user_id', { length: 50 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: varchar('task_id', { length: 50 })
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    assignmentSource: varchar('assignment_source', { length: 20 })
      .$type<'manual' | 'top_manager_auto' | 'project_cascade'>()
      .notNull()
      .default('manual'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.taskId] }),
    check(
      'user_tasks_assignment_source_check',
      sql`${table.assignmentSource} IN ('manual', 'top_manager_auto', 'project_cascade')`,
    ),
  ],
);
