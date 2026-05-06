import { and, asc, desc, eq, getTableColumns, inArray, ne, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { supplierQuoteItems, supplierQuotes } from '../db/schema/supplierQuotes.ts';
import { supplierSales } from '../db/schema/supplierSales.ts';
import { normalizeNullableDateOnly } from '../utils/date.ts';
import { numericForDb, parseDbNumber } from '../utils/parse.ts';

export type SupplierQuote = {
  id: string;
  supplierId: string;
  supplierName: string;
  paymentTerms: string | null;
  status: string;
  expirationDate: string | null;
  linkedOrderId: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
};

export type SupplierQuoteItem = {
  id: string;
  quoteId: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  note: string | null;
  unitType: string;
};

type QuoteRow = typeof supplierQuotes.$inferSelect & { linkedOrderId?: string | null };

const mapQuote = (row: QuoteRow): SupplierQuote => ({
  id: row.id,
  supplierId: row.supplierId,
  supplierName: row.supplierName,
  paymentTerms: row.paymentTerms,
  status: row.status,
  expirationDate: normalizeNullableDateOnly(row.expirationDate, 'supplierQuote.expirationDate'),
  linkedOrderId: row.linkedOrderId ?? null,
  notes: row.notes,
  createdAt: row.createdAt?.getTime() ?? 0,
  updatedAt: row.updatedAt?.getTime() ?? 0,
});

const mapItem = (row: typeof supplierQuoteItems.$inferSelect): SupplierQuoteItem => ({
  id: row.id,
  quoteId: row.quoteId,
  productId: row.productId,
  productName: row.productName,
  quantity: parseDbNumber(row.quantity, 0),
  unitPrice: parseDbNumber(row.unitPrice, 0),
  note: row.note,
  unitType: row.unitType ?? 'unit',
});

export const listAll = async (exec: DbExecutor = db): Promise<SupplierQuote[]> => {
  const rows = await exec
    .select({
      ...getTableColumns(supplierQuotes),
      linkedOrderId: sql<string | null>`(
        SELECT ss.id FROM supplier_sales ss
        WHERE ss.linked_quote_id = ${supplierQuotes.id}
        LIMIT 1
      )`,
    })
    .from(supplierQuotes)
    .orderBy(desc(supplierQuotes.createdAt));
  return rows.map(mapQuote);
};

export const listAllItems = async (exec: DbExecutor = db): Promise<SupplierQuoteItem[]> => {
  const rows = await exec
    .select()
    .from(supplierQuoteItems)
    .orderBy(asc(supplierQuoteItems.createdAt));
  return rows.map(mapItem);
};

export const findById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<SupplierQuote | null> => {
  const rows = await exec.select().from(supplierQuotes).where(eq(supplierQuotes.id, id));
  return rows[0] ? mapQuote(rows[0]) : null;
};

export const existsById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const rows = await exec
    .select({ id: supplierQuotes.id })
    .from(supplierQuotes)
    .where(eq(supplierQuotes.id, id));
  return rows.length > 0;
};

export const findItemsForQuote = async (
  quoteId: string,
  exec: DbExecutor = db,
): Promise<SupplierQuoteItem[]> => {
  const rows = await exec
    .select()
    .from(supplierQuoteItems)
    .where(eq(supplierQuoteItems.quoteId, quoteId));
  return rows.map(mapItem);
};

// Skips the linked-order subquery used by `listAll` because snapshots store on-row data only;
// the order-link join is reconstructed on read, not frozen into history.
export const findFullForSnapshot = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ quote: SupplierQuote; items: SupplierQuoteItem[] } | null> => {
  const [quoteRows, items] = await Promise.all([
    exec.select().from(supplierQuotes).where(eq(supplierQuotes.id, id)).limit(1),
    findItemsForQuote(id, exec),
  ]);
  if (quoteRows.length === 0) return null;
  return { quote: mapQuote(quoteRows[0]), items };
};

export const findLinkedOrderId = async (
  quoteId: string,
  exec: DbExecutor = db,
): Promise<string | null> => {
  const rows = await exec
    .select({ id: supplierSales.id })
    .from(supplierSales)
    .where(eq(supplierSales.linkedQuoteId, quoteId))
    .limit(1);
  return rows[0]?.id ?? null;
};

export const findIdConflict = async (
  newId: string,
  currentId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const rows = await exec
    .select({ id: supplierQuotes.id })
    .from(supplierQuotes)
    .where(and(eq(supplierQuotes.id, newId), ne(supplierQuotes.id, currentId)));
  return rows.length > 0;
};

export type NewSupplierQuote = {
  id: string;
  supplierId: string;
  supplierName: string;
  paymentTerms: string;
  status: string;
  expirationDate: string;
  notes: string | null;
};

export const create = async (
  input: NewSupplierQuote,
  exec: DbExecutor = db,
): Promise<SupplierQuote> => {
  const [row] = await exec
    .insert(supplierQuotes)
    .values({
      id: input.id,
      supplierId: input.supplierId,
      supplierName: input.supplierName,
      paymentTerms: input.paymentTerms,
      status: input.status,
      expirationDate: input.expirationDate,
      notes: input.notes,
    })
    .returning();
  return mapQuote(row);
};

export type SupplierQuoteUpdate = {
  id?: string;
  supplierId?: string | null;
  supplierName?: string | null;
  paymentTerms?: string;
  status?: string;
  expirationDate?: string | null;
  notes?: string | null;
};

export const update = async (
  id: string,
  patch: SupplierQuoteUpdate,
  exec: DbExecutor = db,
): Promise<SupplierQuote | null> => {
  // Empty patch → fall back to SELECT so the row (and updated_at) is left untouched.
  // Matches pre-Drizzle behavior; without this guard, an empty PUT would bump updated_at
  // and create a misleading audit trail.
  if (!Object.values(patch).some((v) => v !== undefined)) {
    return findById(id, exec);
  }
  const [row] = await exec
    .update(supplierQuotes)
    .set({
      id: sql`COALESCE(${patch.id ?? null}, ${supplierQuotes.id})`,
      supplierId: sql`COALESCE(${patch.supplierId ?? null}, ${supplierQuotes.supplierId})`,
      supplierName: sql`COALESCE(${patch.supplierName ?? null}, ${supplierQuotes.supplierName})`,
      paymentTerms: sql`COALESCE(${patch.paymentTerms ?? null}, ${supplierQuotes.paymentTerms})`,
      status: sql`COALESCE(${patch.status ?? null}, ${supplierQuotes.status})`,
      expirationDate: sql`COALESCE(${patch.expirationDate ?? null}::date, ${supplierQuotes.expirationDate})`,
      notes: sql`COALESCE(${patch.notes ?? null}, ${supplierQuotes.notes})`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(supplierQuotes.id, id))
    .returning();
  return row ? mapQuote(row) : null;
};

export type SupplierQuoteRestoreFields = {
  supplierId: string;
  supplierName: string;
  paymentTerms: string;
  status: string;
  expirationDate: string;
  notes: string | null;
};

export const restoreSnapshotQuote = async (
  id: string,
  snapshot: SupplierQuoteRestoreFields,
  exec: DbExecutor = db,
): Promise<SupplierQuote | null> => {
  const [row] = await exec
    .update(supplierQuotes)
    .set({
      supplierId: snapshot.supplierId,
      supplierName: snapshot.supplierName,
      paymentTerms: snapshot.paymentTerms,
      status: snapshot.status,
      expirationDate: snapshot.expirationDate,
      notes: snapshot.notes,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(supplierQuotes.id, id))
    .returning();
  return row ? mapQuote(row) : null;
};

export const deleteById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ supplierName: string } | null> => {
  const rows = await exec
    .delete(supplierQuotes)
    .where(eq(supplierQuotes.id, id))
    .returning({ supplierName: supplierQuotes.supplierName });
  if (!rows[0]) return null;
  return { supplierName: rows[0].supplierName };
};

export type NewSupplierQuoteItem = {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  note: string | null;
  unitType: string;
};

export type QuoteItemSnapshot = {
  supplierQuoteId: string;
  supplierName: string;
  productId: string | null;
  unitPrice: number;
  netCost: number;
};

/**
 * Resolves per-item snapshots used by the client-quotes route to lock in supplier-quote pricing
 * at the moment a client quote is created/updated. Only items belonging to *accepted* supplier
 * quotes are returned.
 */
export const getQuoteItemSnapshots = async (
  itemIds: string[],
  exec: DbExecutor = db,
): Promise<Map<string, QuoteItemSnapshot>> => {
  const uniqueIds = Array.from(new Set(itemIds.filter(Boolean)));
  const snapshots = new Map<string, QuoteItemSnapshot>();
  if (uniqueIds.length === 0) return snapshots;

  const rows = await exec
    .select({
      itemId: supplierQuoteItems.id,
      quoteId: supplierQuotes.id,
      supplierName: supplierQuotes.supplierName,
      productId: supplierQuoteItems.productId,
      unitPrice: supplierQuoteItems.unitPrice,
    })
    .from(supplierQuoteItems)
    .innerJoin(supplierQuotes, eq(supplierQuotes.id, supplierQuoteItems.quoteId))
    .where(and(inArray(supplierQuoteItems.id, uniqueIds), eq(supplierQuotes.status, 'accepted')));

  for (const row of rows) {
    const unitPrice = parseDbNumber(row.unitPrice, 0);
    snapshots.set(row.itemId, {
      supplierQuoteId: row.quoteId,
      supplierName: row.supplierName,
      productId: row.productId,
      unitPrice,
      netCost: unitPrice,
    });
  }
  return snapshots;
};

export const insertItems = async (
  quoteId: string,
  items: NewSupplierQuoteItem[],
  exec: DbExecutor = db,
): Promise<SupplierQuoteItem[]> => {
  if (items.length === 0) return [];
  const rows = await exec
    .insert(supplierQuoteItems)
    .values(
      items.map((item) => ({
        id: item.id,
        quoteId,
        productId: item.productId,
        productName: item.productName,
        quantity: numericForDb(item.quantity),
        unitPrice: numericForDb(item.unitPrice),
        note: item.note,
        unitType: item.unitType,
      })),
    )
    .returning();
  return rows.map(mapItem);
};

export const replaceItems = async (
  quoteId: string,
  items: NewSupplierQuoteItem[],
  exec: DbExecutor = db,
): Promise<SupplierQuoteItem[]> => {
  await exec.delete(supplierQuoteItems).where(eq(supplierQuoteItems.quoteId, quoteId));
  return insertItems(quoteId, items, exec);
};
