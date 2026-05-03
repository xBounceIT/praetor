import { sql } from 'drizzle-orm';
import { boolean, pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';
// Circular: users.role → roles.id, userRoles.user_id → users.id. Both references are passed
// as callbacks (`() => users.id`), so resolution is deferred until the schema is materialized
// — ES modules tolerate the cycle as long as no top-level code reads the imported binding
// during evaluation.
import { users } from './users.ts';

export const roles = pgTable('roles', {
  id: varchar('id', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  isSystem: boolean('is_system').default(false),
  isAdmin: boolean('is_admin').default(false),
  createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: varchar('role_id', { length: 50 })
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permission: varchar('permission', { length: 100 }).notNull(),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permission] })],
);

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
