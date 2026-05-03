import { sql } from 'drizzle-orm';
import { pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.ts';
import { workUnits } from './workUnits.ts';

export const workUnitManagers = pgTable(
  'work_unit_managers',
  {
    workUnitId: varchar('work_unit_id', { length: 50 })
      .notNull()
      .references(() => workUnits.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 50 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.workUnitId, table.userId] })],
);
