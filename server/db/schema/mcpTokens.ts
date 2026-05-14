import { sql } from 'drizzle-orm';
import { index, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.ts';

export type McpTokenScope = 'read_only' | 'full';

export const mcpTokens = pgTable(
  'mcp_tokens',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    userId: varchar('user_id', { length: 50 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    tokenPrefix: varchar('token_prefix', { length: 32 }).notNull(),
    tokenHash: varchar('token_hash', { length: 128 }).notNull(),
    scope: varchar('scope', { length: 16 }).$type<McpTokenScope>().notNull().default('full'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    lastUsedAt: timestamp('last_used_at'),
    revokedAt: timestamp('revoked_at'),
  },
  (table) => [
    uniqueIndex('idx_mcp_tokens_token_hash_unique').on(table.tokenHash),
    index('idx_mcp_tokens_user_id').on(table.userId),
    index('idx_mcp_tokens_active_user').on(table.userId, table.revokedAt),
  ],
);
