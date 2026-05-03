import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

// `user_id` has a runtime FK to `users(id) ON DELETE CASCADE` (defined in schema.sql) —
// same carve-out as `notifications.user_id`: the FK lives in schema.sql until a follow-up
// tier claims it with a constraint-existence guard.
export const reportChatSessions = pgTable(
  'report_chat_sessions',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    userId: varchar('user_id', { length: 50 }).notNull(),
    title: varchar('title', { length: 255 }).notNull().default('AI Reporting'),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_report_chat_sessions_user_updated').on(table.userId, table.updatedAt.desc()),
    index('idx_report_chat_sessions_user_archived').on(table.userId, table.isArchived),
  ],
);
