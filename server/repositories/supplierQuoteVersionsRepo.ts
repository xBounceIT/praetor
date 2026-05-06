import { and, desc, eq } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import {
  type SupplierQuoteVersionSnapshot,
  supplierQuoteVersions,
} from '../db/schema/supplierQuoteVersions.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import type { SupplierQuote, SupplierQuoteItem } from './supplierQuotesRepo.ts';

export type { SupplierQuoteVersionSnapshot } from '../db/schema/supplierQuoteVersions.ts';

export type SupplierQuoteVersionReason = 'update' | 'restore';

export type SupplierQuoteVersionRow = {
  id: string;
  quoteId: string;
  reason: SupplierQuoteVersionReason;
  createdByUserId: string | null;
  createdAt: number;
};

export type SupplierQuoteVersion = SupplierQuoteVersionRow & {
  snapshot: SupplierQuoteVersionSnapshot;
};

type SupplierQuoteVersionRowSelect = Pick<
  typeof supplierQuoteVersions.$inferSelect,
  'id' | 'quoteId' | 'reason' | 'createdByUserId' | 'createdAt'
>;

const mapRow = (row: SupplierQuoteVersionRowSelect): SupplierQuoteVersionRow => ({
  id: row.id,
  quoteId: row.quoteId,
  reason: row.reason === 'restore' ? 'restore' : 'update',
  createdByUserId: row.createdByUserId,
  createdAt: row.createdAt?.getTime() ?? 0,
});

const mapVersion = (row: typeof supplierQuoteVersions.$inferSelect): SupplierQuoteVersion => ({
  ...mapRow(row),
  snapshot: row.snapshot,
});

export const buildSnapshot = (
  quote: SupplierQuote,
  items: SupplierQuoteItem[],
): SupplierQuoteVersionSnapshot => {
  const { linkedOrderId: _linked, ...quoteSnapshot } = quote;
  return { schemaVersion: 1, quote: quoteSnapshot, items };
};

export const listForQuote = async (
  quoteId: string,
  exec: DbExecutor = db,
): Promise<SupplierQuoteVersionRow[]> => {
  const rows = await exec
    .select({
      id: supplierQuoteVersions.id,
      quoteId: supplierQuoteVersions.quoteId,
      reason: supplierQuoteVersions.reason,
      createdByUserId: supplierQuoteVersions.createdByUserId,
      createdAt: supplierQuoteVersions.createdAt,
    })
    .from(supplierQuoteVersions)
    .where(eq(supplierQuoteVersions.quoteId, quoteId))
    .orderBy(desc(supplierQuoteVersions.createdAt));
  return rows.map(mapRow);
};

// Scoped on BOTH quoteId and id so a versionId cannot be used to read a snapshot from a
// different quote (cross-quote restore would otherwise be possible).
export const findById = async (
  quoteId: string,
  versionId: string,
  exec: DbExecutor = db,
): Promise<SupplierQuoteVersion | null> => {
  const rows = await exec
    .select()
    .from(supplierQuoteVersions)
    .where(and(eq(supplierQuoteVersions.quoteId, quoteId), eq(supplierQuoteVersions.id, versionId)))
    .limit(1);
  return rows[0] ? mapVersion(rows[0]) : null;
};

export type NewSupplierQuoteVersionInput = {
  quoteId: string;
  snapshot: SupplierQuoteVersionSnapshot;
  reason: SupplierQuoteVersionReason;
  createdByUserId: string | null;
};

export const insert = async (
  input: NewSupplierQuoteVersionInput,
  exec: DbExecutor = db,
): Promise<SupplierQuoteVersionRow> => {
  const rows = await exec
    .insert(supplierQuoteVersions)
    .values({
      id: generatePrefixedId('sqv'),
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
  const result = await exec
    .delete(supplierQuoteVersions)
    .where(eq(supplierQuoteVersions.quoteId, quoteId));
  return result.rowCount ?? 0;
};
