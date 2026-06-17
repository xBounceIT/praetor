import { sql } from 'drizzle-orm';
import { pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';
import { roles } from './roles.ts';
import { users } from './users.ts';

export const userRoles = pgTable(
  'user_roles',
  {
    userId: varchar('user_id', { length: 50 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: varchar('role_id', { length: 50 })
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })],
);
