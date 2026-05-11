import { sql } from 'drizzle-orm';
import { boolean, check, numeric, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { roles } from './roles.ts';

export type UserAuthMethod = 'local' | 'ldap' | 'oidc' | 'saml';

export const users = pgTable(
  'users',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    username: varchar('username', { length: 100 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    role: varchar('role', { length: 50 })
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    avatarInitials: varchar('avatar_initials', { length: 5 }).notNull(),
    costPerHour: numeric('cost_per_hour', { precision: 10, scale: 2 }).default('0'),
    isDisabled: boolean('is_disabled').default(false),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    employeeType: varchar('employee_type', { length: 20 })
      .$type<'app_user' | 'internal' | 'external'>()
      .default('app_user'),
    authMethod: varchar('auth_method', { length: 20 }).$type<UserAuthMethod>().default('local'),
    authProviderId: varchar('auth_provider_id', { length: 50 }),
  },
  (table) => [
    check(
      'users_employee_type_check',
      sql`${table.employeeType} IN ('app_user', 'internal', 'external')`,
    ),
    check('users_auth_method_check', sql`${table.authMethod} IN ('local', 'ldap', 'oidc', 'saml')`),
  ],
);
