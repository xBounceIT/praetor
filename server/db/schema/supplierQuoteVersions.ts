import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import type { SupplierQuote, SupplierQuoteItem } from '../../repositories/supplierQuotesRepo.ts';
import { supplierQuotes } from './supplierQuotes.ts';
import { users } from './users.ts';

// Versioned envelope so future schema changes on supplier_quotes/supplier_quote_items can
// normalize old snapshots on read instead of being trapped by a frozen JSONB shape. Bump
// `schemaVersion` when the underlying domain types change in a non-additive way. `linkedOrderId`
// is omitted because it's derived from a join, not stored on the row.
export interface SupplierQuoteVersionSnapshot {
  schemaVersion: 1;
  quote: Omit<SupplierQuote, 'linkedOrderId'>;
  items: SupplierQuoteItem[];
}

export const supplierQuoteVersions = pgTable(
  'supplier_quote_versions',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    quoteId: varchar('quote_id', { length: 100 })
      .notNull()
      .references(() => supplierQuotes.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    snapshot: jsonb('snapshot').$type<SupplierQuoteVersionSnapshot>().notNull(),
    reason: varchar('reason', { length: 20 }).notNull().default('update'),
    createdByUserId: varchar('created_by_user_id', { length: 50 }).references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_supplier_quote_versions_quote_id_created_at').on(
      table.quoteId,
      table.createdAt.desc(),
    ),
    check('chk_supplier_quote_versions_reason', sql`${table.reason} IN ('update', 'restore')`),
  ],
);
