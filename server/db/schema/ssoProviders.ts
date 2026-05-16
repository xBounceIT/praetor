import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export type SsoProtocol = 'oidc' | 'saml';

export type StoredSsoRoleMapping = {
  externalGroup: string;
  role: string;
};

export const ssoProviders = pgTable(
  'sso_providers',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    protocol: varchar('protocol', { length: 20 }).$type<SsoProtocol>().notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    enabled: boolean('enabled').default(false),

    issuerUrl: varchar('issuer_url', { length: 1000 }).default(''),
    clientId: varchar('client_id', { length: 255 }).default(''),
    clientSecret: text('client_secret').default(''),
    scopes: varchar('scopes', { length: 500 }).default('openid profile email'),

    metadataUrl: varchar('metadata_url', { length: 1000 }).default(''),
    metadataXml: text('metadata_xml').default(''),
    entryPoint: varchar('entry_point', { length: 1000 }).default(''),
    idpIssuer: varchar('idp_issuer', { length: 1000 }).default(''),
    idpCert: text('idp_cert').default(''),
    spIssuer: varchar('sp_issuer', { length: 1000 }).default(''),
    privateKey: text('private_key').default(''),
    publicCert: text('public_cert').default(''),

    usernameAttribute: varchar('username_attribute', { length: 255 }).default('preferred_username'),
    nameAttribute: varchar('name_attribute', { length: 255 }).default('name'),
    emailAttribute: varchar('email_attribute', { length: 255 }).default('email'),
    groupsAttribute: varchar('groups_attribute', { length: 255 }).default('groups'),
    roleMappings: jsonb('role_mappings').$type<StoredSsoRoleMapping[]>().default(sql`'[]'::jsonb`),

    // OIDC RP-Initiated Logout opt-in. Off by default because some IdPs have hostile
    // end-session UX (forced confirmation pages, broken post-logout redirects).
    endSessionEnabled: boolean('end_session_enabled').default(false),

    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check('sso_providers_protocol_check', sql`${table.protocol} IN ('oidc', 'saml')`),
    uniqueIndex('idx_sso_providers_slug_unique').on(table.slug),
    index('idx_sso_providers_protocol_enabled').on(table.protocol, table.enabled),
  ],
);
