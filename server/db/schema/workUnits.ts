import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const workUnits = pgTable('work_units', {
  id: varchar('id', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  isDisabled: boolean('is_disabled').default(false),
  createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
});
