import { sql } from 'drizzle-orm';
import { boolean, check, numeric, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.ts';

// Per-user app preferences.
export const settings = pgTable(
  'settings',
  {
    id: serial('id').primaryKey(),
    userId: varchar('user_id', { length: 50 })
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    fullName: varchar('full_name', { length: 255 }),
    email: varchar('email', { length: 255 }),
    language: varchar('language', { length: 10 })
      .$type<'en' | 'it' | 'auto'>()
      .notNull()
      .default('auto'),
    dailyGoal: numeric('daily_goal', { precision: 4, scale: 2 }).default('8.00'),
    startOfWeek: varchar('start_of_week', { length: 10 })
      .$type<'Monday' | 'Sunday'>()
      .default('Monday'),
    compactView: boolean('compact_view').default(false),
    treatSaturdayAsHoliday: boolean('treat_saturday_as_holiday').default(true),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check('settings_language_check', sql`${table.language} IN ('en', 'it', 'auto')`),
    check('settings_start_of_week_check', sql`${table.startOfWeek} IN ('Monday', 'Sunday')`),
  ],
);
