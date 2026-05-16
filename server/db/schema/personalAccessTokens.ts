import { sql } from 'drizzle-orm';
import { integer, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.ts';

export const personalAccessTokens = pgTable('personal_access_tokens', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 50 })
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  tokenPrefix: varchar('token_prefix', { length: 32 }).notNull(),
  createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  lastUsedAt: timestamp('last_used_at'),
  // Snapshot of users.token_version at issue time. Auth rejects this PAT if
  // users.token_version has since moved forward (bulk revocation on password
  // rotation). Mirrors the session_version mechanism used for JWTs.
  tokenVersionAtIssue: integer('token_version_at_issue').notNull().default(1),
});
