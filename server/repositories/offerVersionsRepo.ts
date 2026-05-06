import { and, desc, eq } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { type OfferVersionSnapshot, offerVersions } from '../db/schema/offerVersions.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import type { ClientOffer, ClientOfferItem } from './clientOffersRepo.ts';

export type { OfferVersionSnapshot } from '../db/schema/offerVersions.ts';

export type OfferVersionReason = 'update' | 'restore';

export type OfferVersionRow = {
  id: string;
  offerId: string;
  reason: OfferVersionReason;
  createdByUserId: string | null;
  createdAt: number;
};

export type OfferVersion = OfferVersionRow & { snapshot: OfferVersionSnapshot };

type OfferVersionRowSelect = Pick<
  typeof offerVersions.$inferSelect,
  'id' | 'offerId' | 'reason' | 'createdByUserId' | 'createdAt'
>;

const mapRow = (row: OfferVersionRowSelect): OfferVersionRow => ({
  id: row.id,
  offerId: row.offerId,
  reason: row.reason === 'restore' ? 'restore' : 'update',
  createdByUserId: row.createdByUserId,
  createdAt: row.createdAt?.getTime() ?? 0,
});

const mapVersion = (row: typeof offerVersions.$inferSelect): OfferVersion => ({
  ...mapRow(row),
  snapshot: row.snapshot,
});

export const buildSnapshot = (
  offer: ClientOffer,
  items: ClientOfferItem[],
): OfferVersionSnapshot => ({ schemaVersion: 1, offer, items });

export const listForOffer = async (
  offerId: string,
  exec: DbExecutor = db,
): Promise<OfferVersionRow[]> => {
  const rows = await exec
    .select({
      id: offerVersions.id,
      offerId: offerVersions.offerId,
      reason: offerVersions.reason,
      createdByUserId: offerVersions.createdByUserId,
      createdAt: offerVersions.createdAt,
    })
    .from(offerVersions)
    .where(eq(offerVersions.offerId, offerId))
    .orderBy(desc(offerVersions.createdAt));
  return rows.map(mapRow);
};

// Scoped on BOTH offerId and id so a versionId cannot be used to read a snapshot from a
// different offer (cross-offer restore would otherwise be possible).
export const findById = async (
  offerId: string,
  versionId: string,
  exec: DbExecutor = db,
): Promise<OfferVersion | null> => {
  const rows = await exec
    .select()
    .from(offerVersions)
    .where(and(eq(offerVersions.offerId, offerId), eq(offerVersions.id, versionId)))
    .limit(1);
  return rows[0] ? mapVersion(rows[0]) : null;
};

export type NewOfferVersionInput = {
  offerId: string;
  snapshot: OfferVersionSnapshot;
  reason: OfferVersionReason;
  createdByUserId: string | null;
};

export const insert = async (
  input: NewOfferVersionInput,
  exec: DbExecutor = db,
): Promise<OfferVersionRow> => {
  const rows = await exec
    .insert(offerVersions)
    .values({
      id: generatePrefixedId('ov'),
      offerId: input.offerId,
      snapshot: input.snapshot,
      reason: input.reason,
      createdByUserId: input.createdByUserId,
    })
    .returning();
  return mapRow(rows[0]);
};

export const deleteAllForOffer = async (
  offerId: string,
  exec: DbExecutor = db,
): Promise<number> => {
  const result = await exec.delete(offerVersions).where(eq(offerVersions.offerId, offerId));
  return result.rowCount ?? 0;
};
