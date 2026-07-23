import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { clients } from './clients.ts';
import { projects } from './projects.ts';
import { tasks } from './tasks.ts';
import { users } from './users.ts';

// Time-tracking rows. `task_id` is nullable with ON DELETE SET NULL so legacy entries survive
// task deletion; the `timeEntriesTasksJoin` `sql` chunk in `tasksRepo.ts` joins on `task_id`
// with a fallback to `(project_id, name)` to handle entries whose `task_id` is NULL.
export const timeEntries = pgTable(
  'time_entries',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    userId: varchar('user_id', { length: 50 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    clientId: varchar('client_id', { length: 50 })
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    clientName: varchar('client_name', { length: 255 }).notNull(),
    projectId: varchar('project_id', { length: 50 })
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
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
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('idx_time_entries_user_id').on(table.userId),
    index('idx_time_entries_date').on(table.date),
    index('idx_time_entries_client_id').on(table.clientId),
    index('idx_time_entries_project_id').on(table.projectId),
    index('idx_time_entries_task_id').on(table.taskId),
    uniqueIndex('idx_time_entries_entry_key_unique').on(
      table.userId,
      table.date,
      table.projectId,
      table.task,
    ),
    index('idx_time_entries_created_at_id').on(table.createdAt.desc(), table.id.desc()),
    index('idx_time_entries_user_id_created_at_id').on(
      table.userId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    check(
      'time_entries_location_check',
      sql`${table.location} IN ('remote', 'office', 'customer_premise', 'transfer')`,
    ),
    // Storage-layer backstop for the 24h cap enforced in
    // `server/services/timeEntries.ts` (MAX_DURATION_HOURS). Without this,
    // pre-#590 rows with duration > 24 (e.g. the `1_000_000` typo that
    // triggered #516) survive and continue poisoning cost/billing aggregates.
    check(
      'time_entries_duration_max_check',
      sql`${table.duration} >= 0 AND ${table.duration} <= 24`,
    ),
  ],
);
