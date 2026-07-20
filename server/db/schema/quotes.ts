import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import type { PricingSemanticsVersion } from '../../utils/pricing-semantics.ts';
import { clients } from './clients.ts';
import { products } from './products.ts';
import { quoteCommunicationChannels } from './quoteCommunicationChannels.ts';
import { supplierQuotes } from './supplierQuotes.ts';

export const quotes = pgTable(
  'quotes',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    // RESTRICT (not CASCADE): deleting a client must not silently destroy quotes
    // (financial documents). Callers must remove quotes explicitly before deleting the client.
    clientId: varchar('client_id', { length: 50 })
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    clientName: varchar('client_name', { length: 255 }).notNull(),
    paymentTerms: varchar('payment_terms', { length: 20 }).notNull().default('immediate'),
    discount: numeric('discount', { precision: 15, scale: 2 }).notNull().default('0'),
    discountType: varchar('discount_type', { length: 10 })
      .$type<'percentage' | 'currency'>()
      .notNull()
      .default('percentage'),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    expirationDate: date('expiration_date', { mode: 'string' }).notNull(),
    communicationChannelId: varchar('communication_channel_id', { length: 50 })
      .notNull()
      .references(() => quoteCommunicationChannels.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    // 1-to-1 link to a supplier quote (issue #779). Nullable: a client quote with no supplier
    // quote is a valid state. The supplier quote's status mirrors this client quote's status
    // while linked (computed at read time via the reverse lookup). SET NULL on delete so removing
    // the supplier quote just clears the link; CASCADE on update so a supplier-quote id rename
    // keeps the link valid. The partial-unique index below enforces the "1-to-1" guarantee.
    linkedSupplierQuoteId: varchar('linked_supplier_quote_id', { length: 100 }).references(
      () => supplierQuotes.id,
      { onDelete: 'set null', onUpdate: 'cascade' },
    ),
    notes: text('notes'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_quotes_client_id').on(table.clientId),
    index('idx_quotes_status').on(table.status),
    index('idx_quotes_created_at').on(table.createdAt),
    index('idx_quotes_communication_channel_id').on(table.communicationChannelId),
    // At most one client quote may point at a given supplier quote (the other half of the 1-to-1
    // link). Partial (IS NOT NULL) so many quotes can stay unlinked — Postgres allows multiple
    // NULLs but the predicate makes the intent explicit (mirrors the clients.ts unique indexes).
    uniqueIndex('idx_quotes_linked_supplier_quote_id_unique')
      .on(table.linkedSupplierQuoteId)
      .where(sql`${table.linkedSupplierQuoteId} IS NOT NULL`),
    check(
      'quotes_status_check',
      sql`${table.status} IN ('draft', 'sent', 'offer', 'accepted', 'denied')`,
    ),
    check('chk_quotes_discount_type', sql`${table.discountType} IN ('percentage', 'currency')`),
  ],
);

export type QuoteCandidateState = 'active' | 'selected' | 'discarded';

// Commercial alternatives that share the parent quote code, client and pipeline status.
// Header columns still present on `quotes` are maintained as a compatibility projection of the
// first active/selected candidate while callers migrate to this normalized shape.
export const quoteCandidates = pgTable(
  'quote_candidates',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    quoteId: varchar('quote_id', { length: 100 })
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    position: integer('position').notNull().default(0),
    state: varchar('state', { length: 20 })
      .$type<QuoteCandidateState>()
      .notNull()
      .default('active'),
    paymentTerms: varchar('payment_terms', { length: 20 }).notNull().default('immediate'),
    discount: numeric('discount', { precision: 15, scale: 2 }).notNull().default('0'),
    discountType: varchar('discount_type', { length: 10 })
      .$type<'percentage' | 'currency'>()
      .notNull()
      .default('percentage'),
    expirationDate: date('expiration_date', { mode: 'string' }).notNull(),
    communicationChannelId: varchar('communication_channel_id', { length: 50 })
      .notNull()
      .references(() => quoteCommunicationChannels.id, {
        onDelete: 'restrict',
        onUpdate: 'cascade',
      }),
    notes: text('notes'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_quote_candidates_quote_id_position').on(table.quoteId, table.position),
    uniqueIndex('idx_quote_candidates_quote_name_unique').on(
      table.quoteId,
      sql`lower(${table.name})`,
    ),
    uniqueIndex('idx_quote_candidates_one_selected')
      .on(table.quoteId)
      .where(sql`${table.state} = 'selected'`),
    check(
      'quote_candidates_state_check',
      sql`${table.state} IN ('active', 'selected', 'discarded')`,
    ),
    check(
      'chk_quote_candidates_discount_type',
      sql`${table.discountType} IN ('percentage', 'currency')`,
    ),
  ],
);

// `product_id` is nullable: items can be sourced from a supplier_quote_item via
// `supplier_quote_item_id` instead of pointing at a product. `supplier_quote_*` columns
// track items copied from supplier quotes.
export const quoteItems = pgTable(
  'quote_items',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    quoteId: varchar('quote_id', { length: 100 })
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade', onUpdate: 'cascade' }),

    productId: varchar('product_id', { length: 50 }).references(() => products.id, {
      onDelete: 'restrict',
    }),
    productName: varchar('product_name', { length: 255 }).notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1'),
    unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull().default('0'),
    productCost: numeric('product_cost', { precision: 15, scale: 2 }).notNull().default('0'),
    productMolPercentage: numeric('product_mol_percentage', { precision: 5, scale: 2 }),
    supplierQuoteId: varchar('supplier_quote_id', { length: 100 }),
    supplierQuoteItemId: varchar('supplier_quote_item_id', { length: 50 }),
    supplierQuoteSupplierName: varchar('supplier_quote_supplier_name', { length: 255 }),
    supplierQuoteUnitPrice: numeric('supplier_quote_unit_price', { precision: 15, scale: 2 }),
    discount: numeric('discount', { precision: 5, scale: 2 }).default('0'),
    note: text('note'),
    unitType: varchar('unit_type', { length: 10 }).default('hours'),
    // Canonical whole months retained for API/data compatibility. Pricing derives the numeric
    // duration shown in `durationUnit`; the default represents a one-off ×1 item.
    durationMonths: integer('duration_months').notNull().default(1),
    // Unit shown beside the duration: pricing uses that displayed value and 'na' is neutral.
    durationUnit: text('duration_unit').notNull().default('months'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    // Stable, user-controlled line order. This must not be derived from created_at: quote edits
    // replace the line rows and would otherwise reshuffle them after every save.
    position: integer('position').notNull().default(0),
    // Appended in the physical migration and kept last in the Drizzle projection so legacy
    // positional fixtures retain the pre-candidate column order. Nullable during the expand phase
    // so an older server can keep writing while the new release rolls out; repositories normalize
    // legacy nulls to the quote's backfilled default candidate.
    candidateId: varchar('candidate_id', { length: 100 }).references(() => quoteCandidates.id, {
      onDelete: 'cascade',
      onUpdate: 'cascade',
    }),
    pricingSemanticsVersion: integer('pricing_semantics_version')
      .$type<PricingSemanticsVersion>()
      .notNull()
      .default(1),
  },
  (table) => [
    index('idx_quote_items_quote_id').on(table.quoteId),
    index('idx_quote_items_candidate_id').on(table.candidateId),
    index('idx_quote_items_quote_position').on(table.quoteId, table.position),
    // Partial index for the #779 line-sourcing reverse lookups: supplierQuotesRepo's
    // chosenClientQuoteId EXISTS probe and clientQuotesRepo's earliest-sourced-expiration JOIN both
    // correlate on supplier_quote_id, which was otherwise unindexed (sequential scan per probe).
    // Partial (IS NOT NULL) because only supplier-sourced lines carry it — the rest are NULL.
    index('idx_quote_items_supplier_quote_id')
      .on(table.supplierQuoteId)
      .where(sql`${table.supplierQuoteId} IS NOT NULL`),
    check('chk_quote_items_unit_type', sql`${table.unitType} IN ('hours', 'days', 'unit')`),
    check('chk_quote_items_duration_months', sql`${table.durationMonths} >= 1`),
    check('chk_quote_items_duration_unit', sql`${table.durationUnit} IN ('months', 'years', 'na')`),
    check(
      'chk_quote_items_pricing_semantics_version',
      sql`${table.pricingSemanticsVersion} IN (1, 2)`,
    ),
  ],
);
