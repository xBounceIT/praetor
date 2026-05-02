import { sql } from 'drizzle-orm';
import { boolean, integer, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

// Single-row config table: `id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1)` in schema.sql.
// The CHECK constraint isn't modeled here — same carve-out as `settings.ts` ("Drizzle Kit's
// CHECK support is patchy"). Enforcement stays at the DB level.
//
// `role_mappings` uses a structural `$type<...>()` rather than importing the named
// `LdapRoleMapping` from `ldapRepo.ts` — keeping schema → repo as a one-way dependency
// (matches every other repo's convention of owning its domain types).
export const ldapConfig = pgTable('ldap_config', {
  id: integer('id').primaryKey().default(1),
  enabled: boolean('enabled').default(false),
  serverUrl: varchar('server_url', { length: 500 }).default('ldap://ldap.example.com:389'),
  baseDn: varchar('base_dn', { length: 500 }).default('dc=example,dc=com'),
  bindDn: varchar('bind_dn', { length: 500 }).default('cn=read-only-admin,dc=example,dc=com'),
  bindPassword: varchar('bind_password', { length: 255 }).default(''),
  userFilter: varchar('user_filter', { length: 255 }).default('(uid={0})'),
  groupBaseDn: varchar('group_base_dn', { length: 500 }).default('ou=groups,dc=example,dc=com'),
  groupFilter: varchar('group_filter', { length: 255 }).default('(member={0})'),
  roleMappings: jsonb('role_mappings')
    .$type<Array<{ ldapGroup: string; role: string }>>()
    .default(sql`'[]'::jsonb`),
  updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
});
