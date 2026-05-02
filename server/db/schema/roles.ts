import { sql } from 'drizzle-orm';
import { boolean, pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';

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

// `user_id` has a runtime FK to `users(id) ON DELETE CASCADE` (un-modeled here — same
// carve-out as `notifications.user_id`).
export const userRoles = pgTable(
  'user_roles',
  {
    userId: varchar('user_id', { length: 50 }).notNull(),
    roleId: varchar('role_id', { length: 50 })
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })],
);
