import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.ts';

export const reportChatSessions = pgTable(
  'report_chat_sessions',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    userId: varchar('user_id', { length: 50 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
