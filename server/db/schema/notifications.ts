import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const notifications = pgTable(
  'notifications',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    userId: varchar('user_id', { length: 50 }).notNull(),
    type: varchar('type', { length: 50 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    message: text('message'),
    data: jsonb('data').$type<Record<string, unknown> | null>(),
    isRead: boolean('is_read').default(false),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_notifications_user_id').on(table.userId),
    index('idx_notifications_user_unread')
      .on(table.userId, table.isRead)
      .where(sql`${table.isRead} = false`),
  ],
);
