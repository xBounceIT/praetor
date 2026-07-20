import { and, desc, eq } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import {
  type NormalizedQuoteVersionSnapshot,
  type QuoteVersionSnapshot,
  quoteVersions,
  type SnapshotQuoteCandidate,
} from '../db/schema/quoteVersions.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import type { ClientQuote, ClientQuoteItem } from './clientQuotesRepo.ts';

export type { QuoteVersionSnapshot } from '../db/schema/quoteVersions.ts';

export type QuoteVersionReason = 'update' | 'restore';

export type QuoteVersionRow = {
  id: string;
  quoteId: string;
  reason: QuoteVersionReason;
  createdByUserId: string | null;
  createdAt: number;
};

export type QuoteVersion = QuoteVersionRow & { snapshot: NormalizedQuoteVersionSnapshot };

type QuoteVersionRowSelect = Pick<
  typeof quoteVersions.$inferSelect,
  'id' | 'quoteId' | 'reason' | 'createdByUserId' | 'createdAt'
>;

const mapRow = (row: QuoteVersionRowSelect): QuoteVersionRow => ({
  id: row.id,
  quoteId: row.quoteId,
  reason: row.reason === 'restore' ? 'restore' : 'update',
  createdByUserId: row.createdByUserId,
  createdAt: row.createdAt?.getTime() ?? 0,
});

export const normalizeSnapshot = (
  snapshot: QuoteVersionSnapshot,
): NormalizedQuoteVersionSnapshot => {
  if (snapshot.schemaVersion === 2) {
    return {
      ...snapshot,
      candidates: snapshot.candidates.map((candidate) => ({ ...candidate })),
      items: snapshot.items.map((item) => ({
        ...item,
        candidateId: item.candidateId || item.quoteId,
      })),
    };
  }
  const candidateId = snapshot.quote.id;
  return {
    schemaVersion: 2,
    quote: snapshot.quote,
    candidates: [
      {
        id: candidateId,
        quoteId: snapshot.quote.id,
        name: 'Variante A',
        position: 0,
        state: snapshot.quote.status === 'offer' ? 'selected' : 'active',
        paymentTerms: snapshot.quote.paymentTerms ?? 'immediate',
        discount: snapshot.quote.discount,
        discountType: snapshot.quote.discountType,
        expirationDate: snapshot.quote.expirationDate ?? '',
        communicationChannelId: snapshot.quote.communicationChannelId ?? '',
        communicationChannelName: snapshot.quote.communicationChannelName ?? '',
        notes: snapshot.quote.notes,
        createdAt: snapshot.quote.createdAt,
        updatedAt: snapshot.quote.updatedAt,
      },
    ],
    items: snapshot.items.map((item) => ({
      ...item,
      candidateId: item.candidateId || candidateId,
    })),
  };
};

const mapVersion = (row: typeof quoteVersions.$inferSelect): QuoteVersion => ({
  ...mapRow(row),
  snapshot: normalizeSnapshot(row.snapshot),
});

// Record `linkedOfferId` on the snapshot so the saved version is a complete historical record.
// `linkedOfferId` is derived (no column on the quote row), so the restore path does NOT
// re-establish it on the customer_offers side - the link survives restore naturally because
// customer_offers.linked_quote_id is not touched. This is here for completeness / audit / data
// portability. Older snapshots from before this change may not have the field at all.
export const buildSnapshot = (
  quote: Omit<ClientQuote, 'revisionNumber' | 'revisionCode' | 'linkedOfferRevisionCode'>,
  items: ClientQuoteItem[],
  candidates: SnapshotQuoteCandidate[] = [],
): NormalizedQuoteVersionSnapshot => {
  const normalizedItems = items.map((item) => ({
    ...item,
    candidateId: item.candidateId || item.quoteId,
  }));
  const normalizedCandidates =
    candidates.length > 0
      ? candidates.map((candidate) => ({ ...candidate }))
      : normalizeSnapshot({ schemaVersion: 1, quote, items }).candidates;
  return {
    schemaVersion: 2,
    quote,
    candidates: normalizedCandidates,
    items: normalizedItems,
  };
};
export const listForQuote = async (
  quoteId: string,
  exec: DbExecutor = db,
): Promise<QuoteVersionRow[]> => {
  const rows = await exec
    .select({
      id: quoteVersions.id,
      quoteId: quoteVersions.quoteId,
      reason: quoteVersions.reason,
      createdByUserId: quoteVersions.createdByUserId,
      createdAt: quoteVersions.createdAt,
    })
    .from(quoteVersions)
    .where(eq(quoteVersions.quoteId, quoteId))
    .orderBy(desc(quoteVersions.createdAt));
  return rows.map(mapRow);
};

// Scoped on BOTH quoteId and id so a versionId cannot be used to read a snapshot from a
// different quote (cross-quote restore would otherwise be possible).
export const findById = async (
  quoteId: string,
  versionId: string,
  exec: DbExecutor = db,
): Promise<QuoteVersion | null> => {
  const rows = await exec
    .select()
    .from(quoteVersions)
    .where(and(eq(quoteVersions.quoteId, quoteId), eq(quoteVersions.id, versionId)))
    .limit(1);
  return rows[0] ? mapVersion(rows[0]) : null;
};

export type NewQuoteVersionInput = {
  quoteId: string;
  snapshot: QuoteVersionSnapshot;
  reason: QuoteVersionReason;
  createdByUserId: string | null;
};

export const insert = async (
  input: NewQuoteVersionInput,
  exec: DbExecutor = db,
): Promise<QuoteVersionRow> => {
  const rows = await exec
    .insert(quoteVersions)
    .values({
      id: generatePrefixedId('qv'),
      quoteId: input.quoteId,
      snapshot: input.snapshot,
      reason: input.reason,
      createdByUserId: input.createdByUserId,
    })
    .returning();
  return mapRow(rows[0]);
};

export const deleteAllForQuote = async (
  quoteId: string,
  exec: DbExecutor = db,
): Promise<number> => {
  const result = await exec.delete(quoteVersions).where(eq(quoteVersions.quoteId, quoteId));
  return result.rowCount ?? 0;
};
