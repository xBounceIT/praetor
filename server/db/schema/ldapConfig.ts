import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

// Single-row config table — `id` is pinned to 1 by both the column default and a CHECK.
//
// `role_mappings` uses a structural `$type<...>()` rather than importing the named
// `LdapRoleMapping` from `ldapRepo.ts` — keeping schema → repo as a one-way dependency
// (matches every other repo's convention of owning its domain types).
export const ldapConfig = pgTable(
  'ldap_config',
  {
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
    tlsCaCertificate: text('tls_ca_certificate'),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [check('ldap_config_id_check', sql`${table.id} = 1`)],
);
