import { sql } from 'drizzle-orm';
import { boolean, numeric, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';

// Per-user app preferences. The `language`, `start_of_week` columns have CHECK constraints in
// schema.sql that aren't modeled here (Drizzle Kit's CHECK support is patchy across versions);
// they remain enforced at the DB level. The `user_id` runtime FK to `users(id)` is also not
// declared here because `users` is not yet modeled in TS — same carve-out as
// `notifications.user_id` (see db/README.md).
export const settings = pgTable('settings', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 50 }).notNull().unique(),
  fullName: varchar('full_name', { length: 255 }),
  email: varchar('email', { length: 255 }),
  language: varchar('language', { length: 10 }).notNull().default('auto'),
  dailyGoal: numeric('daily_goal', { precision: 4, scale: 2 }).default('8.00'),
  startOfWeek: varchar('start_of_week', { length: 10 }).default('Monday'),
  compactView: boolean('compact_view').default(false),
  treatSaturdayAsHoliday: boolean('treat_saturday_as_holiday').default(true),
  updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
});
