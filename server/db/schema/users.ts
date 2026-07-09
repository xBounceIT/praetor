import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { roles } from './roles.ts';
import { ssoProviders } from './ssoProviders.ts';

// A single TOTP backup (recovery) code as stored in `users.totp_backup_codes`. The plaintext
// code is shown to the user once at generation time; only the bcrypt `hash` is persisted, and
// `usedAt` is stamped (ISO string) when a code is redeemed so it cannot be reused.
export type TotpBackupCode = { hash: string; usedAt: string | null };

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
    // Structured identity parts. `name` remains the required display string; first/last
    // are optional and, for LDAP/SSO-managed users, populated from the directory.
    firstName: varchar('first_name', { length: 255 }),
    lastName: varchar('last_name', { length: 255 }),
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
    address: text('address'),
    notes: text('notes'),
    responsibleUserId: varchar('responsible_user_id', { length: 50 }).references(
      (): AnyPgColumn => users.id,
      {
        onDelete: 'set null',
      },
    ),
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
    // TOTP two-factor authentication. The secret is stored as AES-256-GCM ciphertext (same
    // `crypto.ts` helper as `sso_providers.client_secret`) and decrypted only to verify a code;
    // null means the user has not enrolled. `totp_enabled` flips true only after the user
    // confirms a code during setup, at which point `totp_confirmed_at` is stamped.
    totpSecret: text('totp_secret'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    totpConfirmedAt: timestamp('totp_confirmed_at'),
    totpBackupCodes: jsonb('totp_backup_codes').$type<TotpBackupCode[]>(),
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
    check(
      'users_responsible_not_self_check',
      sql`${table.responsibleUserId} IS NULL OR ${table.responsibleUserId} <> ${table.id}`,
    ),
    uniqueIndex('idx_users_employee_code_unique').on(table.employeeCode),
    index('idx_users_responsible_user_id').on(table.responsibleUserId),
    index('idx_users_auth_provider_id').on(table.authProviderId),
  ],
);
