import { and, asc, desc, eq, getTableColumns, inArray, ne, or, sql } from 'drizzle-orm';
import { type DbExecutor, db, runAtomically } from '../db/drizzle.ts';
import { customerOfferItems } from '../db/schema/customerOfferItems.ts';
import { quoteItems } from '../db/schema/quotes.ts';
import { saleItems } from '../db/schema/sales.ts';
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

// The outer supplier_quotes.id, qualified to the OUTER table for use inside the correlated
// subqueries below. Hand-qualified on purpose: `${supplierQuotes.id}` renders as a BARE "id"
// because the outer query is join-less (Drizzle omits the table prefix), which then (a) shadows
// to the subquery's own inner table id — a silently wrong correlation — and (b) is AMBIGUOUS in
// the offer subqueries that join two id-bearing tables (customer_offers + quotes), aborting the
// whole list query with "column reference \"id\" is ambiguous". The outer table is always
// selected unaliased as "supplier_quotes" (see listAll/findById/lockEffectiveStatusById), so the
// explicit reference is stable. Do NOT replace with ${supplierQuotes.id}.
const outerSupplierQuoteId = sql.raw('"supplier_quotes"."id"');

// The client quote that most-advances this supplier quote, resolved through PRODUCT-LINE sourcing
// (quote_items.supplier_quote_id) — issue #779 follow-up: the 1:1 quotes.linked_supplier_quote_id
// header link was removed as redundant with the per-line sourcing, so a supplier quote now follows
// the furthest-progressed client document whose lines use it. Rank: accepted > offer > sent >
// draft > denied (a dead-end denied quote never outranks a live one); tiebreak most-recently-
// updated. NULL when no client quote sources this supplier quote. The downstream offer is still
// that chosen quote's offer (customer_offers.linked_quote_id), so the derived-status chain
// (effectiveSupplierQuoteStatus) is unchanged — only the quote it follows changed.
// "Most-advanced sourcing quote wins" ordering, shared by the scalar subquery (single-row paths)
// and the list LATERAL below so the CASE lives in one place. Legacy spellings rank with their
// canonical equivalents (confirmed→accepted, received→sent, rejected→denied); draft (and any
// unknown value) sits above the dead-end denied. Tiebreak: most-recently-updated, then id.
const sourcingRankOrderBy = sql`
  CASE COALESCE(cq.status, '')
    WHEN 'accepted' THEN 5
    WHEN 'confirmed' THEN 5
    WHEN 'offer' THEN 4
    WHEN 'sent' THEN 3
    WHEN 'received' THEN 3
    WHEN 'denied' THEN 1
    WHEN 'rejected' THEN 1
    ELSE 2
  END DESC,
  cq.updated_at DESC,
  cq.id`;

const chosenClientQuoteId = sql<string | null>`(
  SELECT cq.id FROM quotes cq
  WHERE EXISTS (
    SELECT 1 FROM quote_items qi
    WHERE qi.quote_id = cq.id AND qi.supplier_quote_id = ${outerSupplierQuoteId}
  )
  ORDER BY ${sourcingRankOrderBy}
  LIMIT 1
)`;

// Same chosen-quote resolution as `chosenClientQuoteId`, but as a LEFT JOIN LATERAL that the list
// query (listAll) joins ONCE per supplier-quote row — then reads id/status/expiration off "chosen"
// and the downstream offer off "chosen_offer". This replaces inlining the scalar subquery 5× in
// the SELECT (Drizzle interpolates the `sql` fragment textually, so Postgres would otherwise
// re-run the ranked quote_items scan once per derived column, per row). The single-row paths
// (findById, lockEffectiveStatusById) keep the scalar subqueries: the 5× cost is negligible for
// one row, and lockEffectiveStatusById's `FOR UPDATE` must not lock the joined quotes/offers rows.
const chosenClientQuoteLateral = sql`LATERAL (
  SELECT cq.id, cq.status, cq.expiration_date
  FROM quotes cq
  WHERE EXISTS (
    SELECT 1 FROM quote_items qi
    WHERE qi.quote_id = cq.id AND qi.supplier_quote_id = ${outerSupplierQuoteId}
  )
  ORDER BY ${sourcingRankOrderBy}
  LIMIT 1
) "chosen"`;

// Derived-status columns for the list projection, read straight off the LATERAL join above
// (customer_offers is unique on linked_quote_id, so the join yields ≤1 offer — equivalent to the
// scalar subqueries' LIMIT 1). ::text so the driver returns 'YYYY-MM-DD' strings, not Date objects.
const lateralDerivedColumns = {
  linkedClientQuoteId: sql<string | null>`"chosen"."id"`,
  linkedClientQuoteStatus: sql<string | null>`"chosen"."status"`,
  linkedClientQuoteExpiration: sql<string | null>`"chosen"."expiration_date"::text`,
  linkedOfferStatus: sql<string | null>`"chosen_offer"."status"`,
  linkedOfferExpiration: sql<string | null>`"chosen_offer"."expiration_date"::text`,
};
const chosenOfferJoin = sql`"customer_offers" "chosen_offer"`;
const chosenOfferJoinOn = sql`"chosen_offer"."linked_quote_id" = "chosen"."id"`;

const linkedClientQuoteIdSubquery = chosenClientQuoteId;
const linkedClientQuoteStatusSubquery = sql<string | null>`(
  SELECT q.status FROM quotes q WHERE q.id = ${chosenClientQuoteId} LIMIT 1
)`;
// ::text so the driver returns the plain 'YYYY-MM-DD' string instead of a Date object.
const linkedClientQuoteExpirationSubquery = sql<string | null>`(
  SELECT q.expiration_date::text FROM quotes q WHERE q.id = ${chosenClientQuoteId} LIMIT 1
)`;
const linkedOfferStatusSubquery = sql<string | null>`(
  SELECT o.status FROM customer_offers o WHERE o.linked_quote_id = ${chosenClientQuoteId} LIMIT 1
)`;
const linkedOfferExpirationSubquery = sql<string | null>`(
  SELECT o.expiration_date::text FROM customer_offers o
  WHERE o.linked_quote_id = ${chosenClientQuoteId} LIMIT 1
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
        WHERE ss.linked_quote_id = ${outerSupplierQuoteId}
        LIMIT 1
      )`,
      // Appended after linkedOrderId so positional row fixtures keep their indices (repo tests).
      // Resolved via the LATERAL join below — the chosen-quote ranking runs ONCE per row, not once
      // per derived column.
      ...lateralDerivedColumns,
    })
    .from(supplierQuotes)
    .leftJoin(chosenClientQuoteLateral, sql`true`)
    .leftJoin(chosenOfferJoin, chosenOfferJoinOn)
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

// Earliest expiration among the given supplier quotes (the ones a client quote sources via its
// lines). The client-quotes progression guard reads it to block advancing a quote backed by a
// stale supplier quote (issue #779 follow-up; replaces the single header-linked expiration).
// Null when the id list is empty or none have an expiration.
export const findEarliestExpirationByIds = async (
  ids: string[],
  exec: DbExecutor = db,
): Promise<string | null> => {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return null;
  const rows = await exec
    .select({ expiration: sql<string | null>`MIN(${supplierQuotes.expirationDate})::text` })
    .from(supplierQuotes)
    .where(inArray(supplierQuotes.id, uniqueIds));
  return normalizeNullableDateOnly(rows[0]?.expiration ?? null, 'supplierQuote.expirationDate');
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

// Whether any client document line (quote, offer, or client-order item) still sources this
// supplier quote. There is deliberately NO FK behind these columns — the link is a soft
// snapshot reference — so the DELETE route must enforce referential safety itself (issue #779):
// deleting a sourced quote would strand the client lines with dead supplierQuoteItemIds and
// 400 their next edit. Checks both the denormalized supplier_quote_id and (for legacy rows
// that only carry the item id) membership in the quote's items.
export const isSourcedByClientDocuments = async (
  quoteId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const itemIdsSubquery = exec
    .select({ id: supplierQuoteItems.id })
    .from(supplierQuoteItems)
    .where(eq(supplierQuoteItems.quoteId, quoteId));
  const [quoteRefs, offerRefs, orderRefs] = await Promise.all([
    exec
      .select({ id: quoteItems.id })
      .from(quoteItems)
      .where(
        or(
          eq(quoteItems.supplierQuoteId, quoteId),
          inArray(quoteItems.supplierQuoteItemId, itemIdsSubquery),
        ),
      )
      .limit(1),
    exec
      .select({ id: customerOfferItems.id })
      .from(customerOfferItems)
      .where(
        or(
          eq(customerOfferItems.supplierQuoteId, quoteId),
          inArray(customerOfferItems.supplierQuoteItemId, itemIdsSubquery),
        ),
      )
      .limit(1),
    exec
      .select({ id: saleItems.id })
      .from(saleItems)
      .where(
        or(
          eq(saleItems.supplierQuoteId, quoteId),
          inArray(saleItems.supplierQuoteItemId, itemIdsSubquery),
        ),
      )
      .limit(1),
  ]);
  return quoteRefs.length > 0 || offerRefs.length > 0 || orderRefs.length > 0;
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
  // No `status`: the stored column is vestigial under the fully-derived model (issue #779) — the
  // routes never patch it, and a writable field here would invite a caller to desync it.
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
 * Resolves per-item snapshots used by the client-quotes/offers/orders routes to lock in
 * supplier-quote pricing at the moment a client document is created/updated. Deliberately NOT
 * status-filtered (issue #779 derived model — see the inline comment on the query): the only
 * way an id misses is that the supplier quote item no longer exists.
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
