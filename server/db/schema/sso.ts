import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { type SsoProtocol, ssoProviders } from './ssoProviders.ts';
import { users } from './users.ts';

export { type SsoProtocol, type StoredSsoRoleMapping, ssoProviders } from './ssoProviders.ts';

export const externalIdentities = pgTable(
  'external_identities',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    providerId: varchar('provider_id', { length: 50 })
      .notNull()
      .references(() => ssoProviders.id, { onDelete: 'cascade' }),
    protocol: varchar('protocol', { length: 20 }).$type<SsoProtocol>().notNull(),
    issuer: varchar('issuer', { length: 1000 }).notNull(),
    subject: varchar('subject', { length: 500 }).notNull(),
    userId: varchar('user_id', { length: 50 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check('external_identities_protocol_check', sql`${table.protocol} IN ('oidc', 'saml')`),
    uniqueIndex('idx_external_identities_identity_unique').on(
      table.providerId,
      table.protocol,
      table.issuer,
      table.subject,
    ),
    index('idx_external_identities_user_id').on(table.userId),
  ],
);

export const ssoStates = pgTable(
  'sso_states',
  {
    state: varchar('state', { length: 255 }).primaryKey(),
    providerId: varchar('provider_id', { length: 50 })
      .notNull()
      .references(() => ssoProviders.id, { onDelete: 'cascade' }),
    protocol: varchar('protocol', { length: 20 }).$type<SsoProtocol>().notNull(),
    codeVerifier: text('code_verifier').default(''),
    relayState: text('relay_state').default(''),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check('sso_states_protocol_check', sql`${table.protocol} IN ('oidc', 'saml')`),
    index('idx_sso_states_expires_at').on(table.expiresAt),
  ],
);

export const ssoLoginTickets = pgTable(
  'sso_login_tickets',
  {
    ticket: varchar('ticket', { length: 255 }).primaryKey(),
    userId: varchar('user_id', { length: 50 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    activeRole: varchar('active_role', { length: 50 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    consumedAt: timestamp('consumed_at'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_sso_login_tickets_user_id').on(table.userId),
    index('idx_sso_login_tickets_expires_at').on(table.expiresAt),
  ],
);
