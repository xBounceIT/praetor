import { and, desc, eq } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { customerOffers } from '../db/schema/customerOffers.ts';
import type { OfferVersionSnapshot } from '../db/schema/offerVersions.ts';
import { quotes } from '../db/schema/quotes.ts';
import type { QuoteVersionSnapshot } from '../db/schema/quoteVersions.ts';
import { offerRevisions, quoteRevisions, supplierQuoteRevisions } from '../db/schema/revisions.ts';
import { supplierQuotes } from '../db/schema/supplierQuotes.ts';
import type { SupplierQuoteVersionSnapshot } from '../db/schema/supplierQuoteVersions.ts';
import { users } from '../db/schema/users.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';

export type RevisionRow = {
  id: string;
  revisionNumber: number;
  revisionCode: string;
  createdByUserId: string | null;
  createdByUserName: string | null;
  createdAt: number;
};

const mapRow = (row: {
  id: string;
  revisionNumber: number;
  revisionCode: string;
  createdByUserId: string | null;
  createdByUserName: string | null;
  createdAt: Date | null;
}): RevisionRow => ({ ...row, createdAt: row.createdAt?.getTime() ?? 0 });

const list = async (
  kind: 'quote' | 'offer' | 'supplierQuote',
  objectId: string,
  exec: DbExecutor,
): Promise<RevisionRow[]> => {
  if (kind === 'quote') {
    const rows = await exec
      .select({
        id: quoteRevisions.id,
        revisionNumber: quoteRevisions.revisionNumber,
        revisionCode: quoteRevisions.revisionCode,
        createdByUserId: quoteRevisions.createdByUserId,
        createdByUserName: users.name,
        createdAt: quoteRevisions.createdAt,
      })
      .from(quoteRevisions)
      .leftJoin(users, eq(users.id, quoteRevisions.createdByUserId))
      .where(eq(quoteRevisions.quoteId, objectId))
      .orderBy(desc(quoteRevisions.revisionNumber));
    return rows.map(mapRow);
  }
  if (kind === 'offer') {
    const rows = await exec
      .select({
        id: offerRevisions.id,
        revisionNumber: offerRevisions.revisionNumber,
        revisionCode: offerRevisions.revisionCode,
        createdByUserId: offerRevisions.createdByUserId,
        createdByUserName: users.name,
        createdAt: offerRevisions.createdAt,
      })
      .from(offerRevisions)
      .leftJoin(users, eq(users.id, offerRevisions.createdByUserId))
      .where(eq(offerRevisions.offerId, objectId))
      .orderBy(desc(offerRevisions.revisionNumber));
    return rows.map(mapRow);
  }
  const rows = await exec
    .select({
      id: supplierQuoteRevisions.id,
      revisionNumber: supplierQuoteRevisions.revisionNumber,
      revisionCode: supplierQuoteRevisions.revisionCode,
      createdByUserId: supplierQuoteRevisions.createdByUserId,
      createdByUserName: users.name,
      createdAt: supplierQuoteRevisions.createdAt,
    })
    .from(supplierQuoteRevisions)
    .leftJoin(users, eq(users.id, supplierQuoteRevisions.createdByUserId))
    .where(eq(supplierQuoteRevisions.quoteId, objectId))
    .orderBy(desc(supplierQuoteRevisions.revisionNumber));
  return rows.map(mapRow);
};

export const listForQuote = (id: string, exec: DbExecutor = db) => list('quote', id, exec);
export const listForOffer = (id: string, exec: DbExecutor = db) => list('offer', id, exec);
export const listForSupplierQuote = (id: string, exec: DbExecutor = db) =>
  list('supplierQuote', id, exec);

export type QuoteRevision = RevisionRow & { snapshot: QuoteVersionSnapshot };
export type OfferRevision = RevisionRow & { snapshot: OfferVersionSnapshot };
export type SupplierQuoteRevision = RevisionRow & { snapshot: SupplierQuoteVersionSnapshot };

export const findQuoteById = async (
  quoteId: string,
  revisionId: string,
  exec: DbExecutor = db,
): Promise<QuoteRevision | null> => {
  const rows = await exec
    .select({ revision: quoteRevisions, createdByUserName: users.name })
    .from(quoteRevisions)
    .leftJoin(users, eq(users.id, quoteRevisions.createdByUserId))
    .where(and(eq(quoteRevisions.quoteId, quoteId), eq(quoteRevisions.id, revisionId)))
    .limit(1);
  const row = rows[0];
  return row
    ? {
        ...mapRow({ ...row.revision, createdByUserName: row.createdByUserName }),
        snapshot: row.revision.snapshot,
      }
    : null;
};

export const findOfferById = async (
  offerId: string,
  revisionId: string,
  exec: DbExecutor = db,
): Promise<OfferRevision | null> => {
  const rows = await exec
    .select({ revision: offerRevisions, createdByUserName: users.name })
    .from(offerRevisions)
    .leftJoin(users, eq(users.id, offerRevisions.createdByUserId))
    .where(and(eq(offerRevisions.offerId, offerId), eq(offerRevisions.id, revisionId)))
    .limit(1);
  const row = rows[0];
  return row
    ? {
        ...mapRow({ ...row.revision, createdByUserName: row.createdByUserName }),
        snapshot: row.revision.snapshot,
      }
    : null;
};

export const findSupplierQuoteById = async (
  quoteId: string,
  revisionId: string,
  exec: DbExecutor = db,
): Promise<SupplierQuoteRevision | null> => {
  const rows = await exec
    .select({ revision: supplierQuoteRevisions, createdByUserName: users.name })
    .from(supplierQuoteRevisions)
    .leftJoin(users, eq(users.id, supplierQuoteRevisions.createdByUserId))
    .where(
      and(eq(supplierQuoteRevisions.quoteId, quoteId), eq(supplierQuoteRevisions.id, revisionId)),
    )
    .limit(1);
  const row = rows[0];
  return row
    ? {
        ...mapRow({ ...row.revision, createdByUserName: row.createdByUserName }),
        snapshot: row.revision.snapshot,
      }
    : null;
};

export const latestQuote = async (quoteId: string, exec: DbExecutor = db) => {
  const rows = await exec
    .select()
    .from(quoteRevisions)
    .where(eq(quoteRevisions.quoteId, quoteId))
    .orderBy(desc(quoteRevisions.revisionNumber))
    .limit(1);
  return rows[0] ?? null;
};
export const latestOffer = async (offerId: string, exec: DbExecutor = db) => {
  const rows = await exec
    .select()
    .from(offerRevisions)
    .where(eq(offerRevisions.offerId, offerId))
    .orderBy(desc(offerRevisions.revisionNumber))
    .limit(1);
  return rows[0] ?? null;
};
export const latestSupplierQuote = async (quoteId: string, exec: DbExecutor = db) => {
  const rows = await exec
    .select()
    .from(supplierQuoteRevisions)
    .where(eq(supplierQuoteRevisions.quoteId, quoteId))
    .orderBy(desc(supplierQuoteRevisions.revisionNumber))
    .limit(1);
  return rows[0] ?? null;
};

type InsertRevisionInput<T> = {
  objectId: string;
  revisionNumber: number;
  revisionCode: string;
  snapshot: T;
  createdByUserId: string | null;
};

export const insertQuoteAndAdvance = async (
  input: InsertRevisionInput<QuoteVersionSnapshot>,
  exec: DbExecutor = db,
) => {
  await exec.insert(quoteRevisions).values({
    id: generatePrefixedId('qr'),
    quoteId: input.objectId,
    revisionNumber: input.revisionNumber,
    revisionCode: input.revisionCode,
    snapshot: input.snapshot,
    createdByUserId: input.createdByUserId,
  });
  await exec
    .update(quotes)
    .set({ revisionNumber: input.revisionNumber, revisionCode: input.revisionCode })
    .where(eq(quotes.id, input.objectId));
};

export const insertOfferAndAdvance = async (
  input: InsertRevisionInput<OfferVersionSnapshot>,
  exec: DbExecutor = db,
) => {
  await exec.insert(offerRevisions).values({
    id: generatePrefixedId('or'),
    offerId: input.objectId,
    revisionNumber: input.revisionNumber,
    revisionCode: input.revisionCode,
    snapshot: input.snapshot,
    createdByUserId: input.createdByUserId,
  });
  await exec
    .update(customerOffers)
    .set({ revisionNumber: input.revisionNumber, revisionCode: input.revisionCode })
    .where(eq(customerOffers.id, input.objectId));
};

export const insertSupplierQuoteAndAdvance = async (
  input: InsertRevisionInput<SupplierQuoteVersionSnapshot>,
  exec: DbExecutor = db,
) => {
  await exec.insert(supplierQuoteRevisions).values({
    id: generatePrefixedId('sqr'),
    quoteId: input.objectId,
    revisionNumber: input.revisionNumber,
    revisionCode: input.revisionCode,
    snapshot: input.snapshot,
    createdByUserId: input.createdByUserId,
  });
  await exec
    .update(supplierQuotes)
    .set({ revisionNumber: input.revisionNumber, revisionCode: input.revisionCode })
    .where(eq(supplierQuotes.id, input.objectId));
};
