import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import type { ClientQuote, ClientQuoteItem } from '../../repositories/clientQuotesRepo.ts';
import { quotes } from './quotes.ts';
import { users } from './users.ts';

// Versioned envelope so future schema changes on quotes/quote_items can normalize old
// snapshots on read instead of being trapped by a frozen JSONB shape. Bump `schemaVersion`
// when the underlying domain types change in a non-additive way. `linkedOfferId` is omitted
// because it's derived from a join, not stored on the row.
export interface QuoteVersionSnapshot {
  schemaVersion: 1;
  quote: Omit<ClientQuote, 'linkedOfferId'>;
  items: ClientQuoteItem[];
}

export const quoteVersions = pgTable(
  'quote_versions',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    quoteId: varchar('quote_id', { length: 100 })
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    snapshot: jsonb('snapshot').$type<QuoteVersionSnapshot>().notNull(),
    reason: varchar('reason', { length: 20 }).notNull().default('update'),
    createdByUserId: varchar('created_by_user_id', { length: 50 }).references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_quote_versions_quote_id_created_at').on(table.quoteId, table.createdAt.desc()),
    check('chk_quote_versions_reason', sql`${table.reason} IN ('update', 'restore')`),
  ],
);
