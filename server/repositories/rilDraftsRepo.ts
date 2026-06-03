import { and, eq, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { rilDrafts, type StoredRilDraftRows } from '../db/schema/rilDrafts.ts';

export type RilDraft = {
  monthKey: string;
  rows: StoredRilDraftRows;
  updatedAt: string | null;
};

const RIL_DRAFT_PROJECTION = {
  monthKey: rilDrafts.monthKey,
  rows: rilDrafts.rows,
  updatedAt: rilDrafts.updatedAt,
} as const;

type RilDraftRow = {
  monthKey: string;
  rows: StoredRilDraftRows | null;
  updatedAt: Date | string | null;
};

const toIso = (value: Date | string | null): string | null => {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const mapRow = (row: RilDraftRow): RilDraft => ({
  monthKey: row.monthKey,
  rows: row.rows ?? {},
  updatedAt: toIso(row.updatedAt),
});

export const getForUserMonth = async (
  userId: string,
  monthKey: string,
  exec: DbExecutor = db,
): Promise<RilDraft | null> => {
  const [row] = await exec
    .select(RIL_DRAFT_PROJECTION)
    .from(rilDrafts)
    .where(and(eq(rilDrafts.userId, userId), eq(rilDrafts.monthKey, monthKey)));
  return row ? mapRow(row) : null;
};

export const upsertForUserMonth = async (
  userId: string,
  monthKey: string,
  rows: StoredRilDraftRows,
  exec: DbExecutor = db,
): Promise<RilDraft> => {
  const [row] = await exec
    .insert(rilDrafts)
    .values({ userId, monthKey, rows })
    .onConflictDoUpdate({
      target: [rilDrafts.userId, rilDrafts.monthKey],
      set: { rows, updatedAt: sql`CURRENT_TIMESTAMP` },
    })
    .returning(RIL_DRAFT_PROJECTION);
  return mapRow(row);
};

export const deleteForUserMonth = async (
  userId: string,
  monthKey: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const deleted = await exec
    .delete(rilDrafts)
    .where(and(eq(rilDrafts.userId, userId), eq(rilDrafts.monthKey, monthKey)))
    .returning({ id: rilDrafts.id });
  return deleted.length > 0;
};
