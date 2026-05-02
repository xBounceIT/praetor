import { sql } from 'drizzle-orm';
import {
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { quotes } from './quotes.ts';

// Final shape after later ALTER TABLEs (discount_type added, discount widened to 15,2).
// `client_id` runtime FK to `clients(id)` (un-modeled).
export const customerOffers = pgTable(
  'customer_offers',
  {
    id: varchar('id', { length: 100 }).primaryKey(),
    linkedQuoteId: varchar('linked_quote_id', { length: 100 })
      .notNull()
      .references(() => quotes.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    clientId: varchar('client_id', { length: 50 }).notNull(),
    clientName: varchar('client_name', { length: 255 }).notNull(),
    paymentTerms: varchar('payment_terms', { length: 20 }).notNull().default('immediate'),
    discount: numeric('discount', { precision: 15, scale: 2 }).notNull().default('0'),
    discountType: varchar('discount_type', { length: 10 }).notNull().default('percentage'),
    status: varchar('status', { length: 20 }).notNull().default('draft'),
    expirationDate: date('expiration_date', { mode: 'string' }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex('idx_customer_offers_linked_quote_id').on(table.linkedQuoteId),
    index('idx_customer_offers_client_id').on(table.clientId),
    index('idx_customer_offers_status').on(table.status),
    index('idx_customer_offers_created_at').on(table.createdAt),
  ],
);
