import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { tasks } from './tasks.ts';

// Time-tracking rows. `user_id`, `client_id`, `project_id` have runtime FKs (un-modeled here);
// `task_id` references `tasks` with ON DELETE SET NULL so legacy entries survive task deletion.
// The `timeEntriesTasksJoin` `sql` chunk in `tasksRepo.ts` joins on `task_id` with a fallback
// to `(project_id, name)` to handle entries whose `task_id` is NULL.
export const timeEntries = pgTable(
  'time_entries',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    userId: varchar('user_id', { length: 50 }).notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    clientId: varchar('client_id', { length: 50 }).notNull(),
    clientName: varchar('client_name', { length: 255 }).notNull(),
    projectId: varchar('project_id', { length: 50 }).notNull(),
    projectName: varchar('project_name', { length: 255 }).notNull(),
    task: varchar('task', { length: 255 }).notNull(),
    taskId: varchar('task_id', { length: 50 }).references(() => tasks.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
    duration: numeric('duration', { precision: 10, scale: 2 }).notNull().default('0'),
    hourlyCost: numeric('hourly_cost', { precision: 10, scale: 2 }).default('0'),
    isPlaceholder: boolean('is_placeholder').default(false),
    location: varchar('location', { length: 20 }).default('remote'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index('idx_time_entries_task_id').on(table.taskId)],
);
