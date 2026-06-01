import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { roles } from './roles.ts';
import { ssoProviders } from './ssoProviders.ts';

export type UserAuthMethod = 'local' | 'ldap' | 'oidc' | 'saml';
export type UserContractType =
  | 'permanent'
  | 'fixed_term'
  | 'contractor'
  | 'internship'
  | 'consultant'
  | 'other';
export type UserEmploymentStatus = 'active' | 'onboarding' | 'on_leave' | 'terminated';
export type UserWorkLocation = 'office' | 'remote' | 'hybrid' | 'customer_site' | 'other';

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
    phone: varchar('phone', { length: 50 }),
    jobTitle: varchar('job_title', { length: 150 }),
    department: varchar('department', { length: 150 }),
    employeeCode: varchar('employee_code', { length: 50 }),
    hireDate: date('hire_date', { mode: 'string' }),
    terminationDate: date('termination_date', { mode: 'string' }),
    contractType: varchar('contract_type', { length: 30 }).$type<UserContractType>(),
    employmentStatus: varchar('employment_status', { length: 30 }).$type<UserEmploymentStatus>(),
    workLocation: varchar('work_location', { length: 30 }).$type<UserWorkLocation>(),
    emergencyContactName: varchar('emergency_contact_name', { length: 255 }),
    emergencyContactPhone: varchar('emergency_contact_phone', { length: 50 }),
    notes: text('notes'),
    authMethod: varchar('auth_method', { length: 20 }).$type<UserAuthMethod>().default('local'),
    authProviderId: varchar('auth_provider_id', { length: 50 }).references(() => ssoProviders.id, {
      onDelete: 'set null',
    }),
    sessionVersion: integer('session_version').notNull().default(1),
    // Bumped on password rotation (and any future bulk-revocation event). Personal
    // access tokens and MCP tokens record the value at issue and are rejected when
    // the user's current `token_version` has moved past it — same mechanism as
    // `session_version` provides for JWTs, but on the long-lived API credentials.
    tokenVersion: integer('token_version').notNull().default(1),
  },
  (table) => [
    check(
      'users_employee_type_check',
      sql`${table.employeeType} IN ('app_user', 'internal', 'external')`,
    ),
    check('users_auth_method_check', sql`${table.authMethod} IN ('local', 'ldap', 'oidc', 'saml')`),
    check(
      'users_contract_type_check',
      sql`${table.contractType} IS NULL OR ${table.contractType} IN ('permanent', 'fixed_term', 'contractor', 'internship', 'consultant', 'other')`,
    ),
    check(
      'users_employment_status_check',
      sql`${table.employmentStatus} IS NULL OR ${table.employmentStatus} IN ('active', 'onboarding', 'on_leave', 'terminated')`,
    ),
    check(
      'users_work_location_check',
      sql`${table.workLocation} IS NULL OR ${table.workLocation} IN ('office', 'remote', 'hybrid', 'customer_site', 'other')`,
    ),
    check(
      'users_hr_date_range_check',
      sql`${table.hireDate} IS NULL OR ${table.terminationDate} IS NULL OR ${table.hireDate} <= ${table.terminationDate}`,
    ),
    uniqueIndex('idx_users_employee_code_unique').on(table.employeeCode),
    index('idx_users_auth_provider_id').on(table.authProviderId),
  ],
);
