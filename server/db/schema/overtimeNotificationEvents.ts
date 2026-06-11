import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.ts';

export type OvertimeNotificationSource = 'tracker' | 'ril_manual';
export type OvertimeReason = 'daily_limit' | 'weekend_or_holiday';

export const overtimeNotificationEvents = pgTable(
  'overtime_notification_events',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    userId: varchar('user_id', { length: 50 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventDate: date('event_date', { mode: 'string' }).notNull(),
    source: varchar('source', { length: 20 }).$type<OvertimeNotificationSource>().notNull(),
    hours: numeric('hours', { precision: 10, scale: 2 }).notNull(),
    reasons: jsonb('reasons').$type<OvertimeReason[]>().notNull().default(sql`'[]'::jsonb`),
    createdBy: varchar('created_by', { length: 50 }).references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique('overtime_notification_events_user_date_source_unique').on(
      table.userId,
      table.eventDate,
      table.source,
    ),
    index('idx_overtime_notification_events_user_date').on(table.userId, table.eventDate),
    check(
      'overtime_notification_events_source_check',
      sql`${table.source} IN ('tracker', 'ril_manual')`,
    ),
    check('overtime_notification_events_hours_check', sql`${table.hours} >= 0`),
    check(
      'overtime_notification_events_reasons_array_check',
      sql`jsonb_typeof(${table.reasons}) = 'array'`,
    ),
  ],
);
