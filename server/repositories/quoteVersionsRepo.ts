import { and, desc, eq } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { type QuoteVersionSnapshot, quoteVersions } from '../db/schema/quoteVersions.ts';
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

export type QuoteVersion = QuoteVersionRow & { snapshot: QuoteVersionSnapshot };

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

const mapVersion = (row: typeof quoteVersions.$inferSelect): QuoteVersion => ({
  ...mapRow(row),
  snapshot: row.snapshot,
});

export const buildSnapshot = (
  quote: ClientQuote,
  items: ClientQuoteItem[],
): QuoteVersionSnapshot => {
  const { linkedOfferId: _linked, ...quoteSnapshot } = quote;
  return { schemaVersion: 1, quote: quoteSnapshot, items };
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
