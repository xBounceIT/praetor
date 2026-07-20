import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { quotes } from './quotes.ts';
import { users } from './users.ts';

// Versioned envelope so future schema changes on quotes/quote_items can normalize old
// snapshots on read instead of being trapped by a frozen JSONB shape. Bump `schemaVersion`
// when the underlying domain types change in a non-additive way.
//
// `linkedOfferId` is derived (subquery against customer_offers.linked_quote_id) rather than
// stored on the quote row, but we still record it in the snapshot so the historical record is
// complete (e.g. for audits and forward-migration tools). Older snapshots predate this field
// and may have it as `undefined`; readers must tolerate both `undefined` and `string | null`.
export interface SnapshotQuote {
  id: string;
  description?: string | null;
  linkedOfferId?: string | null;
  clientId: string;
  clientName: string;
  paymentTerms: string | null;
  discount: number;
  discountType: 'percentage' | 'currency';
  status: string;
  expirationDate: string | null;
  communicationChannelId?: string;
  communicationChannelName?: string;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  linkedSupplierQuoteId: string | null;
  linkedSupplierQuoteExpiration: string | null;
}

export interface LegacySnapshotQuoteItem {
  id: string;
  quoteId: string;
  candidateId?: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  productCost: number;
  productMolPercentage: number | null;
  supplierQuoteId: string | null;
  supplierQuoteItemId: string | null;
  supplierQuoteSupplierName: string | null;
  supplierQuoteUnitPrice: number | null;
  discount: number;
  note: string | null;
  unitType: 'hours' | 'days' | 'unit';
  durationMonths: number;
  durationUnit: 'months' | 'years' | 'na';
}

export type SnapshotQuoteItem = LegacySnapshotQuoteItem & { candidateId: string };
export interface LegacyQuoteVersionSnapshot {
  schemaVersion: 1;
  quote: SnapshotQuote;
  items: LegacySnapshotQuoteItem[];
}

export interface SnapshotQuoteCandidate {
  id: string;
  quoteId: string;
  name: string;
  position: number;
  state: 'active' | 'selected' | 'discarded';
  paymentTerms: string;
  discount: number;
  discountType: 'percentage' | 'currency';
  expirationDate: string;
  communicationChannelId: string;
  communicationChannelName: string;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface QuoteVersionSnapshotV2 {
  schemaVersion: 2;
  quote: SnapshotQuote;
  candidates: SnapshotQuoteCandidate[];
  items: SnapshotQuoteItem[];
}

export type QuoteVersionSnapshot = LegacyQuoteVersionSnapshot | QuoteVersionSnapshotV2;
export type NormalizedQuoteVersionSnapshot = QuoteVersionSnapshotV2;
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
