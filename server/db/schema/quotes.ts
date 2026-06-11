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
import { clients } from './clients.ts';
import { products } from './products.ts';
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
    // Number of months the line item's service runs. Acts as a multiplier alongside
    // `quantity` for both cost and revenue (see issue #757). Defaults to 1 (one-off item),
    // which keeps totals identical to the pre-duration behavior.
    durationMonths: integer('duration_months').notNull().default(1),
    // Display unit for `durationMonths` (issue #757): 'months' (default), 'years', or 'na'.
    // 'na' (N/A) marks a line where duration does not apply and never multiplies (issue #775).
    // Pricing always uses `durationMonths`; this only controls how the value is shown/entered.
    durationUnit: text('duration_unit').notNull().default('months'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_quote_items_quote_id').on(table.quoteId),
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
  ],
);
