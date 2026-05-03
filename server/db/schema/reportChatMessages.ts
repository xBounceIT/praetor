import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { reportChatSessions } from './reportChatSessions.ts';

export const reportChatMessages = pgTable(
  'report_chat_messages',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    sessionId: varchar('session_id', { length: 50 })
      .notNull()
      .references(() => reportChatSessions.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).$type<'user' | 'assistant'>().notNull(),
    content: text('content').notNull(),
    thoughtContent: text('thought_content'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_report_chat_messages_session_created').on(table.sessionId, table.createdAt.asc()),
    check('report_chat_messages_role_check', sql`${table.role} IN ('user', 'assistant')`),
  ],
);
