import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import type { ClientOffer, ClientOfferItem } from '../../repositories/clientOffersRepo.ts';
import { customerOffers } from './customerOffers.ts';
import { users } from './users.ts';

// Versioned envelope so future schema changes on offers/offer_items can normalize old
// snapshots on read instead of being trapped by a frozen JSONB shape. Bump `schemaVersion`
// when the underlying domain types change in a non-additive way.
export interface OfferVersionSnapshot {
  schemaVersion: 1;
  offer: ClientOffer;
  items: ClientOfferItem[];
}

export const offerVersions = pgTable(
  'offer_versions',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    offerId: varchar('offer_id', { length: 100 })
      .notNull()
      .references(() => customerOffers.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    snapshot: jsonb('snapshot').$type<OfferVersionSnapshot>().notNull(),
    reason: varchar('reason', { length: 20 }).notNull().default('update'),
    createdByUserId: varchar('created_by_user_id', { length: 50 }).references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_offer_versions_offer_id_created_at').on(table.offerId, table.createdAt.desc()),
    check('chk_offer_versions_reason', sql`${table.reason} IN ('update', 'restore')`),
  ],
);
