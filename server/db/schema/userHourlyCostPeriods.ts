import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  serial,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.ts';

export const userHourlyCostPeriods = pgTable(
  'user_hourly_cost_periods',
  {
    id: serial('id').primaryKey(),
    userId: varchar('user_id', { length: 50 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // NULL is the mandatory baseline period shown as "Dall'inizio" in the UI.
    // Every later period remains effective until the next effective_from date.
    effectiveFrom: date('effective_from', { mode: 'string' }),
    costPerHour: numeric('cost_per_hour', { precision: 10, scale: 2 }).notNull(),
  },
  (table) => [
    check('user_hourly_cost_periods_cost_non_negative', sql`${table.costPerHour} >= 0`),
    uniqueIndex('idx_user_hourly_cost_periods_user_from_unique').on(
      table.userId,
      table.effectiveFrom,
    ),
    uniqueIndex('idx_user_hourly_cost_periods_baseline_unique')
      .on(table.userId)
      .where(sql`${table.effectiveFrom} IS NULL`),
    index('idx_user_hourly_cost_periods_lookup').on(table.userId, table.effectiveFrom.desc()),
  ],
);
