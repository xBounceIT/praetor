import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { customerOffers } from './customerOffers.ts';
import type { OfferVersionSnapshot } from './offerVersions.ts';
import { quotes } from './quotes.ts';
import type { QuoteVersionSnapshot } from './quoteVersions.ts';
import { supplierQuotes } from './supplierQuotes.ts';
import type { SupplierQuoteVersionSnapshot } from './supplierQuoteVersions.ts';
import { users } from './users.ts';

export const revisionCodeTemplate = pgTable(
  'revision_code_template',
  {
    id: varchar('id', { length: 20 }).primaryKey(),
    prefix: varchar('prefix', { length: 20 }).notNull().default('REV'),
    template: varchar('template', { length: 100 }).notNull().default('{PREFIX}{SEQ}'),
    sequencePadding: integer('sequence_padding').notNull().default(1),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check('chk_revision_code_template_singleton', sql`${table.id} = 'default'`),
    check('chk_revision_code_template_padding', sql`${table.sequencePadding} BETWEEN 1 AND 12`),
    check('chk_revision_code_template_sequence', sql`${table.template} LIKE '%{SEQ}%'`),
  ],
);

const revisionColumns = {
  id: varchar('id', { length: 50 }).primaryKey(),
  revisionNumber: integer('revision_number').notNull(),
  revisionCode: varchar('revision_code', { length: 50 }).notNull(),
  createdByUserId: varchar('created_by_user_id', { length: 50 }).references(() => users.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
};

export const quoteRevisions = pgTable(
  'quote_revisions',
  {
    ...revisionColumns,
    quoteId: varchar('quote_id', { length: 100 })
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    snapshot: jsonb('snapshot').$type<QuoteVersionSnapshot>().notNull(),
  },
  (table) => [
    uniqueIndex('uq_quote_revisions_number').on(table.quoteId, table.revisionNumber),
    index('idx_quote_revisions_quote_created').on(table.quoteId, table.createdAt.desc()),
    check('chk_quote_revisions_number', sql`${table.revisionNumber} > 0`),
  ],
);

export const offerRevisions = pgTable(
  'offer_revisions',
  {
    ...revisionColumns,
    offerId: varchar('offer_id', { length: 100 })
      .notNull()
      .references(() => customerOffers.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    snapshot: jsonb('snapshot').$type<OfferVersionSnapshot>().notNull(),
  },
  (table) => [
    uniqueIndex('uq_offer_revisions_number').on(table.offerId, table.revisionNumber),
    index('idx_offer_revisions_offer_created').on(table.offerId, table.createdAt.desc()),
    check('chk_offer_revisions_number', sql`${table.revisionNumber} > 0`),
  ],
);

export const supplierQuoteRevisions = pgTable(
  'supplier_quote_revisions',
  {
    ...revisionColumns,
    quoteId: varchar('quote_id', { length: 100 })
      .notNull()
      .references(() => supplierQuotes.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    snapshot: jsonb('snapshot').$type<SupplierQuoteVersionSnapshot>().notNull(),
  },
  (table) => [
    uniqueIndex('uq_supplier_quote_revisions_number').on(table.quoteId, table.revisionNumber),
    index('idx_supplier_quote_revisions_quote_created').on(table.quoteId, table.createdAt.desc()),
    check('chk_supplier_quote_revisions_number', sql`${table.revisionNumber} > 0`),
  ],
);
