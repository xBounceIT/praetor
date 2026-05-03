import { sql } from 'drizzle-orm';
import { pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.ts';
import { workUnits } from './workUnits.ts';

export const userWorkUnits = pgTable(
  'user_work_units',
  {
    userId: varchar('user_id', { length: 50 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workUnitId: varchar('work_unit_id', { length: 50 })
      .notNull()
      .references(() => workUnits.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.userId, table.workUnitId] })],
);
