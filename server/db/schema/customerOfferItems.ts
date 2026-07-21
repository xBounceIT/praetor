import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import type { PricingSemanticsVersion } from '../../utils/pricing-semantics.ts';
import type { UnitType } from '../../utils/unit-type.ts';
import { customerOffers } from './customerOffers.ts';
import { products } from './products.ts';

export const customerOfferItems = pgTable(
  'customer_offer_items',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    offerId: varchar('offer_id', { length: 100 })
      .notNull()
      .references(() => customerOffers.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    productId: varchar('product_id', { length: 50 }).references(() => products.id, {
      onDelete: 'set null',
    }),
    productName: varchar('product_name', { length: 255 }).notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1'),
    unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull().default('0'),
    productCost: numeric('product_cost', { precision: 15, scale: 2 }).notNull().default('0'),
    productMolPercentage: numeric('product_mol_percentage', { precision: 5, scale: 2 }),
    discount: numeric('discount', { precision: 5, scale: 2 }).default('0'),
    note: text('note'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    unitType: varchar('unit_type', { length: 10 }).$type<UnitType>().default('hours'),
    supplierQuoteId: varchar('supplier_quote_id', { length: 100 }),
    supplierQuoteItemId: varchar('supplier_quote_item_id', { length: 50 }),
    supplierQuoteSupplierName: varchar('supplier_quote_supplier_name', { length: 255 }),
    // Supplier-derived costs retain fractional cents so quantity/duration round only at total.
    supplierQuoteUnitPrice: numeric('supplier_quote_unit_price', { precision: 19, scale: 6 }),
    // Canonical whole months retained for API/data compatibility; defaults to a one-off item.
    durationMonths: integer('duration_months').notNull().default(1),
    // Unit shown beside the duration: pricing uses that displayed value and 'na' is neutral.
    durationUnit: text('duration_unit').notNull().default('months'),
    pricingSemanticsVersion: integer('pricing_semantics_version')
      .$type<PricingSemanticsVersion>()
      .notNull()
      .default(1),
  },
  (table) => [
    index('idx_customer_offer_items_offer_id').on(table.offerId),
    check(
      'chk_customer_offer_items_unit_type',
      sql`${table.unitType} IN ('hours', 'days', 'unit')`,
    ),
    check('chk_customer_offer_items_duration_months', sql`${table.durationMonths} >= 1`),
    check(
      'chk_customer_offer_items_duration_unit',
      sql`${table.durationUnit} IN ('months', 'years', 'na')`,
    ),
    check(
      'chk_customer_offer_items_pricing_semantics_version',
      sql`${table.pricingSemanticsVersion} IN (1, 2)`,
    ),
  ],
);
