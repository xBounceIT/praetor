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
      // RESTRICT (not CASCADE): deleting a role must not silently drop secondary user_roles
      // assignments that appeared between an in-use precheck and the DELETE.
      .references(() => roles.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })],
);
