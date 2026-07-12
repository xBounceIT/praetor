import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { type QuoteCandidateState, quoteCandidates } from '../db/schema/quotes.ts';
import { normalizeNullableDateOnly } from '../utils/date.ts';
import { numericForDb, parseDbNumber } from '../utils/parse.ts';

export type QuoteCandidate = {
  id: string;
  quoteId: string;
  name: string;
  position: number;
  state: QuoteCandidateState;
  paymentTerms: string;
  discount: number;
  discountType: 'percentage' | 'currency';
  expirationDate: string;
  communicationChannelId: string;
  communicationChannelName: string;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
};

const communicationChannelName = sql<string>`(
  SELECT qcc.name
  FROM quote_communication_channels qcc
  WHERE qcc.id = quote_candidates.communication_channel_id
  LIMIT 1
)`;

const projection = {
  id: quoteCandidates.id,
  quoteId: quoteCandidates.quoteId,
  name: quoteCandidates.name,
  position: quoteCandidates.position,
  state: quoteCandidates.state,
  paymentTerms: quoteCandidates.paymentTerms,
  discount: quoteCandidates.discount,
  discountType: quoteCandidates.discountType,
  expirationDate: quoteCandidates.expirationDate,
  communicationChannelId: quoteCandidates.communicationChannelId,
  communicationChannelName,
  notes: quoteCandidates.notes,
  createdAt: quoteCandidates.createdAt,
  updatedAt: quoteCandidates.updatedAt,
};

type CandidateRow = {
  id: string;
  quoteId: string;
  name: string;
  position: number;
  state: QuoteCandidateState;
  paymentTerms: string;
  discount: string | number;
  discountType: 'percentage' | 'currency';
  expirationDate: string;
  communicationChannelId: string;
  communicationChannelName: string;
  notes: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

const mapCandidate = (row: CandidateRow): QuoteCandidate => ({
  ...row,
  discount: parseDbNumber(row.discount, 0),
  discountType: row.discountType === 'currency' ? 'currency' : 'percentage',
  expirationDate:
    normalizeNullableDateOnly(row.expirationDate, 'quoteCandidate.expirationDate') ??
    row.expirationDate,
  createdAt: row.createdAt?.getTime() ?? 0,
  updatedAt: row.updatedAt?.getTime() ?? 0,
});

export const listAll = async (exec: DbExecutor = db): Promise<QuoteCandidate[]> => {
  const rows = await exec
    .select(projection)
    .from(quoteCandidates)
    .orderBy(asc(quoteCandidates.quoteId), asc(quoteCandidates.position), asc(quoteCandidates.id));
  return rows.map((row) => mapCandidate(row as CandidateRow));
};

export const listForQuote = async (
  quoteId: string,
  exec: DbExecutor = db,
): Promise<QuoteCandidate[]> => {
  const rows = await exec
    .select(projection)
    .from(quoteCandidates)
    .where(eq(quoteCandidates.quoteId, quoteId))
    .orderBy(asc(quoteCandidates.position), asc(quoteCandidates.id));
  return rows.map((row) => mapCandidate(row as CandidateRow));
};

export const findById = async (
  quoteId: string,
  candidateId: string,
  exec: DbExecutor = db,
): Promise<QuoteCandidate | null> => {
  const rows = await exec
    .select(projection)
    .from(quoteCandidates)
    .where(and(eq(quoteCandidates.quoteId, quoteId), eq(quoteCandidates.id, candidateId)))
    .limit(1);
  return rows[0] ? mapCandidate(rows[0] as CandidateRow) : null;
};

export const lockById = async (
  quoteId: string,
  candidateId: string,
  exec: DbExecutor = db,
): Promise<QuoteCandidate | null> => {
  const rows = await exec
    .select(projection)
    .from(quoteCandidates)
    .where(and(eq(quoteCandidates.quoteId, quoteId), eq(quoteCandidates.id, candidateId)))
    .for('update');
  return rows[0] ? mapCandidate(rows[0] as CandidateRow) : null;
};

export type NewQuoteCandidate = {
  id: string;
  quoteId: string;
  name: string;
  position: number;
  state?: QuoteCandidateState;
  paymentTerms: string;
  discount: number;
  discountType: 'percentage' | 'currency';
  expirationDate: string;
  communicationChannelId: string;
  notes: string | null;
};

export const insert = async (
  input: NewQuoteCandidate,
  exec: DbExecutor = db,
): Promise<QuoteCandidate> => {
  const rows = await exec
    .insert(quoteCandidates)
    .values({
      ...input,
      state: input.state ?? 'active',
      discount: numericForDb(input.discount),
    })
    .returning(projection);
  return mapCandidate(rows[0] as CandidateRow);
};

export const update = async (
  quoteId: string,
  candidateId: string,
  input: Omit<NewQuoteCandidate, 'id' | 'quoteId' | 'state'>,
  exec: DbExecutor = db,
): Promise<QuoteCandidate | null> => {
  const rows = await exec
    .update(quoteCandidates)
    .set({
      name: input.name,
      position: input.position,
      paymentTerms: input.paymentTerms,
      discount: numericForDb(input.discount),
      discountType: input.discountType,
      expirationDate: input.expirationDate,
      communicationChannelId: input.communicationChannelId,
      notes: input.notes,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(quoteCandidates.quoteId, quoteId), eq(quoteCandidates.id, candidateId)))
    .returning(projection);
  return rows[0] ? mapCandidate(rows[0] as CandidateRow) : null;
};

export const deleteMissingActive = async (
  quoteId: string,
  retainedIds: string[],
  exec: DbExecutor = db,
): Promise<void> => {
  const condition =
    retainedIds.length === 0
      ? and(eq(quoteCandidates.quoteId, quoteId), eq(quoteCandidates.state, 'active'))
      : and(
          eq(quoteCandidates.quoteId, quoteId),
          eq(quoteCandidates.state, 'active'),
          ...retainedIds.map((id) => ne(quoteCandidates.id, id)),
        );
  await exec.delete(quoteCandidates).where(condition);
};

export const deleteAllForQuote = async (quoteId: string, exec: DbExecutor = db): Promise<void> => {
  await exec.delete(quoteCandidates).where(eq(quoteCandidates.quoteId, quoteId));
};

export const markPromoted = async (
  quoteId: string,
  selectedId: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec
    .update(quoteCandidates)
    .set({
      state: sql`CASE WHEN ${quoteCandidates.id} = ${selectedId}
        THEN 'selected' ELSE 'discarded' END`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(quoteCandidates.quoteId, quoteId), eq(quoteCandidates.state, 'active')));
};

export const reactivateAll = async (quoteId: string, exec: DbExecutor = db): Promise<void> => {
  await exec
    .update(quoteCandidates)
    .set({ state: 'active', updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(quoteCandidates.quoteId, quoteId));
};
