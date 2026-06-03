import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, serial, timestamp, unique, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.ts';

// The five user-editable fields of a single RIL row. Computed fields (hours, picap, worked)
// are derived on the client from entrance/exit, so they are intentionally not persisted.
export type StoredRilDraftRow = {
  entrance: string;
  exit: string;
  notes: string;
  transfer: string;
  code: string;
};

// Map of day-of-month (stringified 1..31) to its edited fields. Stored as a sparse object so a
// draft only carries the days the user actually touched.
export type StoredRilDraftRows = Record<string, StoredRilDraftRow>;

// Per-user, per-month draft of the RIL attendance form. Rows live only in client state today and
// are lost on refresh; this table makes the manual edits durable across reloads and devices.
export const rilDrafts = pgTable(
  'ril_drafts',
  {
    id: serial('id').primaryKey(),
    userId: varchar('user_id', { length: 50 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    monthKey: varchar('month_key', { length: 7 }).notNull(),
    rows: jsonb('rows').$type<StoredRilDraftRows>().notNull().default(sql`'{}'::jsonb`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique('ril_drafts_user_month_unique').on(table.userId, table.monthKey),
    check('ril_drafts_month_key_check', sql`${table.monthKey} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check('ril_drafts_rows_object_check', sql`jsonb_typeof(${table.rows}) = 'object'`),
  ],
);
