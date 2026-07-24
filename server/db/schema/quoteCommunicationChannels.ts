import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

export const quoteCommunicationChannels = pgTable(
  'quote_communication_channels',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    icon: varchar('icon', { length: 50 }).notNull().default('comments'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_quote_communication_channels_name').on(table.name),
    uniqueIndex('quote_communication_channels_name_unique').on(sql`lower(${table.name})`),
  ],
);
