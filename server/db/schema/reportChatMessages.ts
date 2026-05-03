import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { reportChatSessions } from './reportChatSessions.ts';

// `role` carries a CHECK (role IN ('user', 'assistant')) constraint at the DB level
// (defined in schema.sql). Drizzle's pg-core has no first-class CHECK helper — don't
// broaden the role union without coordinating a CHECK update.
export const reportChatMessages = pgTable(
  'report_chat_messages',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    sessionId: varchar('session_id', { length: 50 })
      .notNull()
      .references(() => reportChatSessions.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).notNull(),
    content: text('content').notNull(),
    thoughtContent: text('thought_content'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_report_chat_messages_session_created').on(table.sessionId, table.createdAt.asc()),
  ],
);
