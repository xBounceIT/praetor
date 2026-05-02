import { sql } from 'drizzle-orm';
import { pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';

// FK references on `workUnitId` and `userId` are intentionally omitted: per the Phase 3
// migration plan, FKs to tables not yet modeled (or modeled in the same tier) stay declared
// only in `schema.sql`. The retroactive `.references(...)` backfill is a deferred follow-up.
export const workUnitManagers = pgTable(
  'work_unit_managers',
  {
    workUnitId: varchar('work_unit_id', { length: 50 }).notNull(),
    userId: varchar('user_id', { length: 50 }).notNull(),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.workUnitId, table.userId] })],
);
