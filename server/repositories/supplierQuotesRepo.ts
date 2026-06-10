import { and, asc, desc, eq, getTableColumns, inArray, ne, sql } from 'drizzle-orm';
import { type DbExecutor, db, runAtomically } from '../db/drizzle.ts';
import { supplierQuoteItems, supplierQuotes } from '../db/schema/supplierQuotes.ts';
import { supplierSales } from '../db/schema/supplierSales.ts';
import { normalizeNullableDateOnly } from '../utils/date.ts';
import { type DurationUnit, normalizeDurationUnit } from '../utils/duration-unit.ts';
import { numericForDb, parseDbNumber } from '../utils/parse.ts';

export type SupplierQuote = {
  id: string;
  supplierId: string;
  supplierName: string;
  clientId: string | null;
  clientName: string | null;
  paymentTerms: string | null;
  status: string;
  expirationDate: string | null;
  linkedOrderId: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  // The client quote (if any) that links to this supplier quote via the 1-to-1
  // quotes.linked_supplier_quote_id FK (issue #779). The supplier quote's visible status is
  // FULLY DERIVED from this chain: the linked quote's status/expiration, and — when an offer was
  // created from that quote — the offer's status/expiration. All fields are null when unlinked.
  linkedClientQuoteId: string | null;
  linkedClientQuoteStatus: string | null;
  linkedClientQuoteExpiration: string | null;
  linkedOfferStatus: string | null;
  linkedOfferExpiration: string | null;
};

// Reverse-lookup correlated subqueries: the at-most-one client quote pointing at this supplier
// quote (the partial-unique index on quotes.linked_supplier_quote_id guarantees ≤ 1), and the
// at-most-one offer created from that quote (partial-unique on customer_offers.linked_quote_id).
// Mirrors the linkedOrderId subquery pattern; all null when this supplier quote is unlinked.
const linkedClientQuoteIdSubquery = sql<string | null>`(
  SELECT q.id FROM quotes q WHERE q.linked_supplier_quote_id = ${supplierQuotes.id} LIMIT 1
)`;
const linkedClientQuoteStatusSubquery = sql<string | null>`(
  SELECT q.status FROM quotes q WHERE q.linked_supplier_quote_id = ${supplierQuotes.id} LIMIT 1
)`;
// ::text so the driver returns the plain 'YYYY-MM-DD' string instead of a Date object.
const linkedClientQuoteExpirationSubquery = sql<string | null>`(
  SELECT q.expiration_date::text FROM quotes q
  WHERE q.linked_supplier_quote_id = ${supplierQuotes.id} LIMIT 1
)`;
const linkedOfferStatusSubquery = sql<string | null>`(
  SELECT o.status FROM customer_offers o
  JOIN quotes q ON o.linked_quote_id = q.id
  WHERE q.linked_supplier_quote_id = ${supplierQuotes.id} LIMIT 1
)`;
const linkedOfferExpirationSubquery = sql<string | null>`(
  SELECT o.expiration_date::text FROM customer_offers o
  JOIN quotes q ON o.linked_quote_id = q.id
  WHERE q.linked_supplier_quote_id = ${supplierQuotes.id} LIMIT 1
)`;

export type SupplierQuoteItem = {
  id: string;
  quoteId: string;
  productId: string | null;
  productName: string;
  quantity: number;
  listPrice: number;
  discountPercent: number;
  unitPrice: number;
  note: string | null;
  unitType: string;
  durationMonths: number;
  durationUnit: DurationUnit;
};

type QuoteRow = typeof supplierQuotes.$inferSelect & {
  linkedOrderId?: string | null;
  linkedClientQuoteId?: string | null;
  linkedClientQuoteStatus?: string | null;
  linkedClientQuoteExpiration?: string | null;
  linkedOfferStatus?: string | null;
  linkedOfferExpiration?: string | null;
};

const mapQuote = (row: QuoteRow): SupplierQuote => ({
  id: row.id,
  supplierId: row.supplierId,
  supplierName: row.supplierName,
  clientId: row.clientId ?? null,
  clientName: row.clientName ?? null,
  paymentTerms: row.paymentTerms,
  status: row.status,
  expirationDate: normalizeNullableDateOnly(row.expirationDate, 'supplierQuote.expirationDate'),
  linkedOrderId: row.linkedOrderId ?? null,
  notes: row.notes,
  createdAt: row.createdAt?.getTime() ?? 0,
  updatedAt: row.updatedAt?.getTime() ?? 0,
  linkedClientQuoteId: row.linkedClientQuoteId ?? null,
  linkedClientQuoteStatus: row.linkedClientQuoteStatus ?? null,
  linkedClientQuoteExpiration: row.linkedClientQuoteExpiration ?? null,
  linkedOfferStatus: row.linkedOfferStatus ?? null,
  linkedOfferExpiration: row.linkedOfferExpiration ?? null,
});

const mapItem = (row: typeof supplierQuoteItems.$inferSelect): SupplierQuoteItem => ({
  id: row.id,
  quoteId: row.quoteId,
  productId: row.productId,
  productName: row.productName,
  quantity: parseDbNumber(row.quantity, 0),
  listPrice: parseDbNumber(row.listPrice, 0),
  discountPercent: parseDbNumber(row.discountPercent, 0),
  unitPrice: parseDbNumber(row.unitPrice, 0),
  note: row.note,
  unitType: row.unitType ?? 'unit',
  durationMonths: row.durationMonths ?? 1,
  durationUnit: normalizeDurationUnit(row.durationUnit),
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
      // Appended after linkedOrderId so positional row fixtures keep their indices (repo tests).
      linkedClientQuoteId: linkedClientQuoteIdSubquery,
      linkedClientQuoteStatus: linkedClientQuoteStatusSubquery,
      linkedClientQuoteExpiration: linkedClientQuoteExpirationSubquery,
      linkedOfferStatus: linkedOfferStatusSubquery,
      linkedOfferExpiration: linkedOfferExpirationSubquery,
    })
    .from(supplierQuotes)
    .orderBy(desc(supplierQuotes.createdAt));
  return rows.map(mapQuote);
};

export const listAllItems = async (exec: DbExecutor = db): Promise<SupplierQuoteItem[]> => {
  const rows = await exec
    .select()
    .from(supplierQuoteItems)
    .orderBy(asc(supplierQuoteItems.createdAt), asc(supplierQuoteItems.id));
  return rows.map(mapItem);
};

export const findById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<SupplierQuote | null> => {
  const rows = await exec
    .select({
      ...getTableColumns(supplierQuotes),
      linkedClientQuoteId: linkedClientQuoteIdSubquery,
      linkedClientQuoteStatus: linkedClientQuoteStatusSubquery,
      linkedClientQuoteExpiration: linkedClientQuoteExpirationSubquery,
      linkedOfferStatus: linkedOfferStatusSubquery,
      linkedOfferExpiration: linkedOfferExpirationSubquery,
    })
    .from(supplierQuotes)
    .where(eq(supplierQuotes.id, id));
  return rows[0] ? mapQuote(rows[0]) : null;
};

// The supplier quote's own expiration date, used by the client-quotes route to compute the
// "linked supplier quote expired" indicator on the write path (where the response is built from
// the BASE projection, which doesn't reconstruct that derivation). Null when the quote is gone.
export const findExpirationById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<string | null> => {
  const rows = await exec
    .select({ expirationDate: supplierQuotes.expirationDate })
    .from(supplierQuotes)
    .where(eq(supplierQuotes.id, id));
  return rows[0]
    ? normalizeNullableDateOnly(rows[0].expirationDate, 'supplierQuote.expirationDate')
    : null;
};

export const existsById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const rows = await exec
    .select({ id: supplierQuotes.id })
    .from(supplierQuotes)
    .where(eq(supplierQuotes.id, id));
  return rows.length > 0;
};

// SELECT ... FOR UPDATE (must be called inside a transaction) that also resolves the linked
// client quote's status, so callers
// (supplier-order create / clients-order supplier auto-create) can decide "is this supplier quote
// effectively accepted?" — mirror the linked client status, override with `expired` from the
// supplier quote's OWN expiration — atomically under the row lock (issue #779). The scalar
// subquery on `quotes` is unaffected by FOR UPDATE (only the supplier_quotes row is locked).
export const lockEffectiveStatusById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{
  expirationDate: string | null;
  linkedClientStatus: string | null;
  linkedClientQuoteExpiration: string | null;
  linkedOfferStatus: string | null;
  linkedOfferExpiration: string | null;
} | null> => {
  const rows = await exec
    .select({
      expirationDate: supplierQuotes.expirationDate,
      linkedClientStatus: linkedClientQuoteStatusSubquery,
      linkedClientQuoteExpiration: linkedClientQuoteExpirationSubquery,
      linkedOfferStatus: linkedOfferStatusSubquery,
      linkedOfferExpiration: linkedOfferExpirationSubquery,
    })
    .from(supplierQuotes)
    .where(eq(supplierQuotes.id, id))
    .for('update');
  if (!rows[0]) return null;
  return {
    expirationDate: normalizeNullableDateOnly(
      rows[0].expirationDate,
      'supplierQuote.expirationDate',
    ),
    linkedClientStatus: rows[0].linkedClientStatus ?? null,
    linkedClientQuoteExpiration: rows[0].linkedClientQuoteExpiration ?? null,
    linkedOfferStatus: rows[0].linkedOfferStatus ?? null,
    linkedOfferExpiration: rows[0].linkedOfferExpiration ?? null,
  };
};

export const findItemsForQuote = async (
  quoteId: string,
  exec: DbExecutor = db,
): Promise<SupplierQuoteItem[]> => {
  const rows = await exec
    .select()
    .from(supplierQuoteItems)
    .where(eq(supplierQuoteItems.quoteId, quoteId))
    .orderBy(asc(supplierQuoteItems.createdAt), asc(supplierQuoteItems.id));
  return rows.map(mapItem);
};

// Skips the linked-order subquery used by `listAll` because snapshots store on-row data only;
// the order-link join is reconstructed on read, not frozen into history.
export const findFullForSnapshot = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ quote: SupplierQuote; items: SupplierQuoteItem[] } | null> => {
  const quoteRows = await exec
    .select()
    .from(supplierQuotes)
    .where(eq(supplierQuotes.id, id))
    .limit(1);
  if (quoteRows.length === 0) return null;
  const items = await findItemsForQuote(id, exec);
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
  clientId: string | null;
  clientName: string | null;
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
      clientId: input.clientId,
      clientName: input.clientName,
      paymentTerms: input.paymentTerms,
      status: input.status,
      expirationDate: input.expirationDate,
      notes: input.notes,
    })
    .returning();
  return mapQuote(row);
};

export type SupplierQuoteUpdate = {
  supplierId?: string | null;
  supplierName?: string | null;
  // clientId/clientName accept an explicit `null` to clear the customer link. Unlike the
  // COALESCE-guarded fields above, `undefined` means "leave untouched" while `null` writes a
  // NULL — the optional association in issue #759 must be removable, not just settable.
  clientId?: string | null;
  clientName?: string | null;
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
      supplierId: sql`COALESCE(${patch.supplierId ?? null}, ${supplierQuotes.supplierId})`,
      supplierName: sql`COALESCE(${patch.supplierName ?? null}, ${supplierQuotes.supplierName})`,
      // Direct write (not COALESCE) so an explicit null clears the link; `undefined` keeps it.
      clientId: patch.clientId === undefined ? sql`${supplierQuotes.clientId}` : patch.clientId,
      clientName:
        patch.clientName === undefined ? sql`${supplierQuotes.clientName}` : patch.clientName,
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

// Separate from update() so generic patches can't mutate the PK (issue #621). Relies on
// ON UPDATE CASCADE on every incoming FK; see server/test/db/renamablePkFkCascade.test.ts.
export const rename = async (
  currentId: string,
  newId: string,
  exec: DbExecutor = db,
): Promise<SupplierQuote | null> => {
  const [row] = await exec
    .update(supplierQuotes)
    .set({ id: newId, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(supplierQuotes.id, currentId))
    .returning();
  return row ? mapQuote(row) : null;
};

export type SupplierQuoteRestoreFields = {
  supplierId: string;
  supplierName: string;
  clientId: string | null;
  clientName: string | null;
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
      clientId: snapshot.clientId,
      clientName: snapshot.clientName,
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
  listPrice: number;
  discountPercent: number;
  unitPrice: number;
  note: string | null;
  unitType: string;
  durationMonths: number;
  durationUnit: DurationUnit;
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
 * at the moment a client quote is created/updated. Only items belonging to *effectively accepted*
 * supplier quotes are returned (issue #779): the effective pipeline status — the linked client
 * quote's status when linked, otherwise the supplier quote's own status — must be `accepted`.
 * (`accepted` is terminal/frozen, so a past own-expiration does not demote it — matching the
 * pre-#779 behavior where an accepted supplier quote's items stayed sourceable.)
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
    // No status filter (issue #779 derived model): supplier quotes start as draft and progress
    // only with the client document that uses them, so sourcing must work from draft quotes —
    // and re-saving a client quote whose supplier quote has since progressed must not 400. The
    // views gate which quotes are offered for NEW sourcing.
    .where(inArray(supplierQuoteItems.id, uniqueIds));

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

export const findItemsByIds = async (
  ids: string[],
  exec: DbExecutor = db,
): Promise<SupplierQuoteItem[]> => {
  if (ids.length === 0) return [];
  const rows = await exec
    .select()
    .from(supplierQuoteItems)
    .where(inArray(supplierQuoteItems.id, ids));
  return rows.map(mapItem);
};

export type SupplierItemSyncPatch = {
  itemId: string;
  quantity: number;
  unitCost: number;
  discountPercent: number;
};

// Client-driven pricing sync (issue #779, client → supplier direction): writes the new quantity
// and unit cost, recomputing the list price so the stored "discount to us" stays meaningful
// (listPrice × (1 − discount/100) = cost). A 100% discount cannot express a non-zero cost, so it
// resets to 0 with listPrice = cost. Bumps the parent quote's updated_at like any content edit.
export const syncItemPricing = async (
  quoteId: string,
  patches: SupplierItemSyncPatch[],
  exec: DbExecutor = db,
): Promise<void> => {
  for (const patch of patches) {
    const keepDiscount = patch.discountPercent < 100;
    const discountPercent = keepDiscount ? patch.discountPercent : 0;
    const listPrice = keepDiscount
      ? patch.unitCost / (1 - patch.discountPercent / 100)
      : patch.unitCost;
    await exec
      .update(supplierQuoteItems)
      .set({
        quantity: numericForDb(patch.quantity),
        unitPrice: numericForDb(patch.unitCost),
        listPrice: numericForDb(listPrice),
        discountPercent: numericForDb(discountPercent),
      })
      .where(eq(supplierQuoteItems.id, patch.itemId));
  }
  await exec
    .update(supplierQuotes)
    .set({ updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(supplierQuotes.id, quoteId));
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
        listPrice: numericForDb(item.listPrice),
        discountPercent: numericForDb(item.discountPercent),
        unitPrice: numericForDb(item.unitPrice),
        note: item.note,
        unitType: item.unitType,
        // Duration applies to every line type (issue #775); 'na' marks a line that never multiplies
        // and is gated through effectiveDurationMonths, so the value is persisted verbatim here.
        durationMonths: item.durationMonths ?? 1,
        durationUnit: item.durationUnit ?? 'months',
      })),
    )
    .returning();
  return rows.map(mapItem);
};

export const replaceItems = async (
  quoteId: string,
  items: NewSupplierQuoteItem[],
  exec: DbExecutor = db,
): Promise<SupplierQuoteItem[]> =>
  runAtomically(exec, async (tx) => {
    await tx.delete(supplierQuoteItems).where(eq(supplierQuoteItems.quoteId, quoteId));
    return insertItems(quoteId, items, tx);
  });
