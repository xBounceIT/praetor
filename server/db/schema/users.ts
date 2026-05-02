import { sql } from 'drizzle-orm';
import { boolean, numeric, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

// FK reference on `role` (→ roles, already modeled) is intentionally omitted: per the Phase 3
// migration plan, `.references(...)` backfill on already-modeled child schemas is a deferred
// follow-up. The existing `users_role_fkey` continues to live in schema.sql.
export const users = pgTable('users', {
  id: varchar('id', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  username: varchar('username', { length: 100 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  role: varchar('role', { length: 50 }).notNull(),
  avatarInitials: varchar('avatar_initials', { length: 5 }).notNull(),
  costPerHour: numeric('cost_per_hour', { precision: 10, scale: 2 }).default('0'),
  isDisabled: boolean('is_disabled').default(false),
  createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  employeeType: varchar('employee_type', { length: 20 }).default('app_user'),
});
