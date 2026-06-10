import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { type DbExecutor, db, runAtomically } from '../db/drizzle.ts';
import { customerOffers } from '../db/schema/customerOffers.ts';
import { quoteItems, quotes } from '../db/schema/quotes.ts';
import { sales } from '../db/schema/sales.ts';
import { normalizeNullableDateOnly } from '../utils/date.ts';
import { type DurationUnit, normalizeDurationUnit } from '../utils/duration-unit.ts';
import { numericForDb, parseDbNumber, parseNullableDbNumber } from '../utils/parse.ts';
import { normalizeUnitType, type UnitType } from '../utils/unit-type.ts';

export type ClientQuote = {
  id: string;
  linkedOfferId: string | null;
  clientId: string;
  clientName: string;
  paymentTerms: string | null;
  discount: number;
  discountType: 'percentage' | 'currency';
  status: string;
  expirationDate: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  // `linkedSupplierQuoteId` is the vestigial pre-#779 1:1 header link column — never written under
  // line sourcing (kept only so old rows/snapshots still parse). `linkedSupplierQuoteExpiration` is
  // the EARLIEST expiration among the supplier quotes this quote sources via its lines (issue #779
  // follow-up), surfaced so the route computes the "supplier quote expired" guard/indicator without
  // a second round-trip. Null when the quote sources no supplier quote.
  linkedSupplierQuoteId: string | null;
  linkedSupplierQuoteExpiration: string | null;
};

export type ClientQuoteItem = {
  id: string;
  quoteId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  productCost: number;
  productMolPercentage: number | null;
  supplierQuoteId: string | null;
  supplierQuoteItemId: string | null;
  supplierQuoteSupplierName: string | null;
  supplierQuoteUnitPrice: number | null;
  discount: number;
  note: string | null;
  unitType: UnitType;
  durationMonths: number;
  durationUnit: DurationUnit;
};

// Correlated subquery used by list/find projections. create/update use `null::varchar`
// instead because no offer can exist yet for a freshly-written row.
// The outer quotes.id, qualified to the OUTER table for use inside the correlated subqueries
// below. Hand-qualified on purpose: `${quotes.id}` renders as a BARE "id" because the consuming
// queries are join-less (Drizzle omits the table prefix), and a bare "id" then resolves against
// the SUBQUERY's own inner table first (customer_offers/quote_items also have an id) — silently
// mis-correlating. The outer table is always selected unaliased as "quotes" (listAll /
// findCurrent / lockCurrentById), so the explicit reference is stable. See supplierQuotesRepo for
// the same trap (it additionally ERRORED on a JOIN subquery). Do NOT replace with ${quotes.id}.
const outerQuoteId = sql.raw('"quotes"."id"');

const linkedOfferIdSubquery = sql<
  string | null
>`(SELECT co.id FROM customer_offers co WHERE co.linked_quote_id = ${outerQuoteId} LIMIT 1)`;

// The earliest expiration among the supplier quotes this client quote SOURCES via its product
// lines (issue #779 follow-up: the 1:1 header link was removed). The route's progression guard and
// the response `linkedSupplierQuoteExpired` flag both read this — an earliest-date past today means
// at least one sourced supplier quote is stale. NULL when the quote sources no supplier quote.
const linkedSupplierQuoteExpirationSubquery = sql<string | null>`(
  SELECT MIN(sq.expiration_date)::text FROM quote_items qi
  JOIN supplier_quotes sq ON sq.id = qi.supplier_quote_id
  WHERE qi.quote_id = ${outerQuoteId}
)`;

const QUOTE_LIST_PROJECTION = {
  id: quotes.id,
  linkedOfferId: linkedOfferIdSubquery,
  clientId: quotes.clientId,
  clientName: quotes.clientName,
  paymentTerms: quotes.paymentTerms,
  discount: quotes.discount,
  discountType: quotes.discountType,
  status: quotes.status,
  expirationDate: quotes.expirationDate,
  notes: quotes.notes,
  createdAt: quotes.createdAt,
  updatedAt: quotes.updatedAt,
  // Appended after updatedAt so positional row fixtures keep their indices (see repo tests).
  linkedSupplierQuoteId: quotes.linkedSupplierQuoteId,
  linkedSupplierQuoteExpiration: linkedSupplierQuoteExpirationSubquery,
} as const;

const QUOTE_BASE_PROJECTION = {
  id: quotes.id,
  linkedOfferId: sql<string | null>`null::varchar`,
  clientId: quotes.clientId,
  clientName: quotes.clientName,
  paymentTerms: quotes.paymentTerms,
  discount: quotes.discount,
  discountType: quotes.discountType,
  status: quotes.status,
  expirationDate: quotes.expirationDate,
  notes: quotes.notes,
  createdAt: quotes.createdAt,
  updatedAt: quotes.updatedAt,
  // The link id is a real column (returned on writes); the linked expiration is a read-only
  // derivation we don't reconstruct on the write path (mirrors linkedOfferId being null here).
  linkedSupplierQuoteId: quotes.linkedSupplierQuoteId,
  linkedSupplierQuoteExpiration: sql<string | null>`null::date`,
} as const;

type ClientQuoteSelectRow = {
  id: string;
  linkedOfferId: string | null;
  clientId: string;
  clientName: string;
  paymentTerms: string;
  discount: string | number;
  discountType: string;
  status: string;
  expirationDate: string | null;
  notes: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  linkedSupplierQuoteId: string | null;
  linkedSupplierQuoteExpiration: string | null;
};

const mapQuote = (row: ClientQuoteSelectRow): ClientQuote => ({
  id: row.id,
  linkedOfferId: row.linkedOfferId,
  clientId: row.clientId,
  clientName: row.clientName,
  paymentTerms: row.paymentTerms,
  discount: parseDbNumber(row.discount, 0),
  discountType: row.discountType === 'currency' ? 'currency' : 'percentage',
  status: row.status,
  expirationDate: normalizeNullableDateOnly(row.expirationDate, 'quote.expirationDate'),
  notes: row.notes,
  createdAt: row.createdAt?.getTime() ?? 0,
  updatedAt: row.updatedAt?.getTime() ?? 0,
  linkedSupplierQuoteId: row.linkedSupplierQuoteId ?? null,
  linkedSupplierQuoteExpiration: normalizeNullableDateOnly(
    row.linkedSupplierQuoteExpiration,
    'quote.linkedSupplierQuoteExpiration',
  ),
});

// `quote_items.product_id` is nullable in the DB (an item can be sourced from a supplier quote
// item via `supplierQuoteItemId` instead of pointing at a product). The frontend treats
// `productId` with falsy checks (`if (!item.productId)`), so we project null to '' here to
// keep `ClientQuoteItem.productId: string` and avoid a frontend-wide type widen. The
// route-side counterpart writes `productId: item.productId || null` so '' never round-trips
// into the DB. `ExistingQuoteItemSnapshot.productId` (read for diff/comparison flows) keeps
// the true `string | null` shape.
const mapItem = (row: typeof quoteItems.$inferSelect): ClientQuoteItem => ({
  id: row.id,
  quoteId: row.quoteId,
  productId: row.productId ?? '',
  productName: row.productName,
  quantity: parseDbNumber(row.quantity, 0),
  unitPrice: parseDbNumber(row.unitPrice, 0),
  productCost: parseDbNumber(row.productCost, 0),
  productMolPercentage: parseNullableDbNumber(row.productMolPercentage),
  supplierQuoteId: row.supplierQuoteId,
  supplierQuoteItemId: row.supplierQuoteItemId,
  supplierQuoteSupplierName: row.supplierQuoteSupplierName,
  supplierQuoteUnitPrice: parseNullableDbNumber(row.supplierQuoteUnitPrice),
  discount: parseDbNumber(row.discount, 0),
  note: row.note,
  unitType: normalizeUnitType(row.unitType),
  durationMonths: row.durationMonths ?? 1,
  durationUnit: normalizeDurationUnit(row.durationUnit),
});

export const listAll = async (exec: DbExecutor = db): Promise<ClientQuote[]> => {
  const rows = await exec
    .select(QUOTE_LIST_PROJECTION)
    .from(quotes)
    .orderBy(desc(quotes.createdAt));
  return rows.map(mapQuote);
};

export const listAllItems = async (exec: DbExecutor = db): Promise<ClientQuoteItem[]> => {
  const rows = await exec.select().from(quoteItems).orderBy(quoteItems.createdAt);
  return rows.map(mapItem);
};

export const existsById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const rows = await exec.select({ id: quotes.id }).from(quotes).where(eq(quotes.id, id));
  return rows.length > 0;
};

export const findIdConflict = async (
  newId: string,
  currentId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const rows = await exec
    .select({ id: quotes.id })
    .from(quotes)
    .where(and(eq(quotes.id, newId), ne(quotes.id, currentId)));
  return rows.length > 0;
};

// Shared shape for the update/restore/offer-create gates. Carries the quote's own status +
// expiration (to derive the effective status, including `expired`) and the 1-to-1 link plus the
// linked supplier quote's OWN expiration (to enforce the "linked supplier quote expired" guard on
// client-status progression — issue #779).
export type ClientQuoteGate = {
  status: string;
  discount: number;
  discountType: 'percentage' | 'currency';
  expirationDate: string | null;
  linkedSupplierQuoteId: string | null;
  linkedSupplierQuoteExpiration: string | null;
};

const GATE_PROJECTION = {
  status: quotes.status,
  discount: quotes.discount,
  discountType: quotes.discountType,
  expirationDate: quotes.expirationDate,
  linkedSupplierQuoteId: quotes.linkedSupplierQuoteId,
  linkedSupplierQuoteExpiration: linkedSupplierQuoteExpirationSubquery,
} as const;

const mapGateRow = (row: {
  status: string;
  discount: string | number;
  discountType: string;
  expirationDate: string | null;
  linkedSupplierQuoteId: string | null;
  linkedSupplierQuoteExpiration: string | null;
}): ClientQuoteGate => ({
  status: row.status,
  discount: parseDbNumber(row.discount, 0),
  discountType: row.discountType === 'currency' ? 'currency' : 'percentage',
  expirationDate: normalizeNullableDateOnly(row.expirationDate, 'quote.expirationDate'),
  linkedSupplierQuoteId: row.linkedSupplierQuoteId ?? null,
  linkedSupplierQuoteExpiration: normalizeNullableDateOnly(
    row.linkedSupplierQuoteExpiration,
    'quote.linkedSupplierQuoteExpiration',
  ),
});

// Reads the minimal set of fields needed to gate updates / restores. Does not acquire a row
// lock - safe for non-mutating reads, but TOCTOU-prone when a write decision depends on it.
// For SELECT ... FOR UPDATE semantics call `lockCurrentById` inside `withDbTransaction`.
export const findCurrent = async (
  id: string,
  exec: DbExecutor = db,
): Promise<ClientQuoteGate | null> => {
  const rows = await exec.select(GATE_PROJECTION).from(quotes).where(eq(quotes.id, id));
  return rows[0] ? mapGateRow(rows[0]) : null;
};

// SELECT ... FOR UPDATE variant of `findCurrent`. Must be called inside a transaction; the
// row lock is released on commit/rollback. Use when a subsequent write (or a gate against a
// concurrent insert that references this row's id) depends on the read.
export const lockCurrentById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<ClientQuoteGate | null> => {
  const rows = await exec
    .select(GATE_PROJECTION)
    .from(quotes)
    .where(eq(quotes.id, id))
    .for('update');
  return rows[0] ? mapGateRow(rows[0]) : null;
};

export const findStatusAndClientName = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ status: string; clientName: string } | null> => {
  const rows = await exec
    .select({ status: quotes.status, clientName: quotes.clientName })
    .from(quotes)
    .where(eq(quotes.id, id));
  return rows[0] ?? null;
};

export const findLinkedOfferId = async (
  quoteId: string,
  exec: DbExecutor = db,
): Promise<string | null> => {
  const rows = await exec
    .select({ id: customerOffers.id })
    .from(customerOffers)
    .where(eq(customerOffers.linkedQuoteId, quoteId))
    .limit(1);
  return rows[0]?.id ?? null;
};

export const findNonDraftLinkedSale = async (
  quoteId: string,
  exec: DbExecutor = db,
): Promise<string | null> => {
  const rows = await exec
    .select({ id: sales.id })
    .from(sales)
    .where(and(eq(sales.linkedQuoteId, quoteId), ne(sales.status, 'draft')))
    .limit(1);
  return rows[0]?.id ?? null;
};

export const deleteDraftSalesForQuote = async (
  quoteId: string,
  exec: DbExecutor = db,
): Promise<void> => {
  await exec.delete(sales).where(and(eq(sales.linkedQuoteId, quoteId), eq(sales.status, 'draft')));
};

export const findAnyLinkedSale = async (
  quoteId: string,
  exec: DbExecutor = db,
): Promise<string | null> => {
  const rows = await exec
    .select({ id: sales.id })
    .from(sales)
    .where(eq(sales.linkedQuoteId, quoteId))
    .limit(1);
  return rows[0]?.id ?? null;
};

export type ExistingQuoteItemSnapshot = {
  id: string;
  productId: string | null;
  // The stored quantity — the supplier-item sync diffs the incoming line against it to tell a
  // genuine client edit from a stale-snapshot re-save (issue #779).
  quantity: number;
  productCost: number;
  productMolPercentage: number | null;
  supplierQuoteId: string | null;
  supplierQuoteItemId: string | null;
  supplierQuoteSupplierName: string | null;
  supplierQuoteUnitPrice: number | null;
  unitType: UnitType;
};

export const findItemSnapshotsForQuote = async (
  quoteId: string,
  exec: DbExecutor = db,
): Promise<ExistingQuoteItemSnapshot[]> => {
  const rows = await exec
    .select({
      id: quoteItems.id,
      productId: quoteItems.productId,
      quantity: quoteItems.quantity,
      productCost: quoteItems.productCost,
      productMolPercentage: quoteItems.productMolPercentage,
      supplierQuoteId: quoteItems.supplierQuoteId,
      supplierQuoteItemId: quoteItems.supplierQuoteItemId,
      supplierQuoteSupplierName: quoteItems.supplierQuoteSupplierName,
      supplierQuoteUnitPrice: quoteItems.supplierQuoteUnitPrice,
      unitType: quoteItems.unitType,
    })
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quoteId));
  return rows.map((row) => ({
    id: row.id,
    productId: row.productId,
    quantity: parseDbNumber(row.quantity, 0),
    productCost: parseDbNumber(row.productCost, 0),
    productMolPercentage: parseNullableDbNumber(row.productMolPercentage),
    supplierQuoteId: row.supplierQuoteId,
    supplierQuoteItemId: row.supplierQuoteItemId,
    supplierQuoteSupplierName: row.supplierQuoteSupplierName,
    supplierQuoteUnitPrice: parseNullableDbNumber(row.supplierQuoteUnitPrice),
    unitType: normalizeUnitType(row.unitType),
  }));
};

export const findItemTotals = async (
  quoteId: string,
  exec: DbExecutor = db,
): Promise<
  Array<{
    quantity: number;
    unitPrice: number;
    discount: number;
    durationMonths: number;
    durationUnit: DurationUnit;
  }>
> => {
  const rows = await exec
    .select({
      quantity: quoteItems.quantity,
      unitPrice: quoteItems.unitPrice,
      discount: quoteItems.discount,
      durationMonths: quoteItems.durationMonths,
      durationUnit: quoteItems.durationUnit,
    })
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quoteId));
  return rows.map((row) => ({
    quantity: parseDbNumber(row.quantity, 0),
    unitPrice: parseDbNumber(row.unitPrice, 0),
    discount: parseDbNumber(row.discount, 0),
    durationMonths: row.durationMonths ?? 1,
    durationUnit: normalizeDurationUnit(row.durationUnit),
  }));
};

export const findItemsForQuote = async (
  quoteId: string,
  exec: DbExecutor = db,
): Promise<ClientQuoteItem[]> => {
  const rows = await exec
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quoteId))
    .orderBy(asc(quoteItems.createdAt), asc(quoteItems.id));
  return rows.map(mapItem);
};

// Uses BASE projection (linkedOfferId NULL) because snapshots store on-row data only;
// the offer-link join is reconstructed on read, not frozen into history.
export const findFullForSnapshot = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ quote: ClientQuote; items: ClientQuoteItem[] } | null> => {
  const quoteRows = await exec
    .select(QUOTE_BASE_PROJECTION)
    .from(quotes)
    .where(eq(quotes.id, id))
    .limit(1);
  if (quoteRows.length === 0) return null;
  const items = await findItemsForQuote(id, exec);
  return { quote: mapQuote(quoteRows[0]), items };
};

export type NewClientQuote = {
  id: string;
  clientId: string;
  clientName: string;
  paymentTerms: string;
  discount: number;
  discountType: 'percentage' | 'currency';
  status: string;
  expirationDate: string;
  notes: string | null;
  linkedSupplierQuoteId?: string | null;
};

export const create = async (
  input: NewClientQuote,
  exec: DbExecutor = db,
): Promise<ClientQuote> => {
  const rows = await exec
    .insert(quotes)
    .values({
      id: input.id,
      clientId: input.clientId,
      clientName: input.clientName,
      paymentTerms: input.paymentTerms,
      discount: numericForDb(input.discount),
      discountType: input.discountType,
      status: input.status,
      expirationDate: input.expirationDate,
      notes: input.notes,
      linkedSupplierQuoteId: input.linkedSupplierQuoteId ?? null,
    })
    .returning(QUOTE_BASE_PROJECTION);
  return mapQuote(rows[0]);
};

export type ClientQuoteUpdate = {
  clientId?: string | null;
  clientName?: string | null;
  paymentTerms?: string | null;
  discount?: number | null;
  discountType?: 'percentage' | 'currency' | null;
  status?: string | null;
  expirationDate?: string | null;
  notes?: string | null;
  // `undefined` leaves the link untouched; an explicit `null` clears it (direct write, not
  // COALESCE — the 1-to-1 supplier-quote link must be removable, mirroring supplierQuotes.clientId).
  linkedSupplierQuoteId?: string | null;
};

export type ClientQuoteRestoreFields = Pick<
  ClientQuote,
  'clientId' | 'clientName' | 'discount' | 'discountType' | 'status' | 'notes'
> & {
  paymentTerms: string;
  expirationDate: string;
};

export const update = async (
  id: string,
  patch: ClientQuoteUpdate,
  exec: DbExecutor = db,
): Promise<ClientQuote | null> => {
  const rows = await exec
    .update(quotes)
    .set({
      clientId: sql`COALESCE(${patch.clientId ?? null}, ${quotes.clientId})`,
      clientName: sql`COALESCE(${patch.clientName ?? null}, ${quotes.clientName})`,
      paymentTerms: sql`COALESCE(${patch.paymentTerms ?? null}, ${quotes.paymentTerms})`,
      discount: sql`COALESCE(${numericForDb(patch.discount) ?? null}::numeric, ${quotes.discount})`,
      discountType: sql`COALESCE(${patch.discountType ?? null}, ${quotes.discountType})`,
      status: sql`COALESCE(${patch.status ?? null}, ${quotes.status})`,
      expirationDate: sql`COALESCE(${patch.expirationDate ?? null}::date, ${quotes.expirationDate})`,
      notes: sql`COALESCE(${patch.notes ?? null}, ${quotes.notes})`,
      // Direct write (not COALESCE) so an explicit null clears the 1-to-1 link; `undefined` keeps it.
      linkedSupplierQuoteId:
        patch.linkedSupplierQuoteId === undefined
          ? sql`${quotes.linkedSupplierQuoteId}`
          : patch.linkedSupplierQuoteId,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(quotes.id, id))
    .returning(QUOTE_BASE_PROJECTION);
  return rows[0] ? mapQuote(rows[0]) : null;
};

// Separate from update() so generic patches can't mutate the PK (issue #621). Relies on
// ON UPDATE CASCADE on every incoming FK; see server/test/db/renamablePkFkCascade.test.ts.
export const rename = async (
  currentId: string,
  newId: string,
  exec: DbExecutor = db,
): Promise<ClientQuote | null> => {
  const rows = await exec
    .update(quotes)
    .set({ id: newId, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(quotes.id, currentId))
    .returning(QUOTE_BASE_PROJECTION);
  return rows[0] ? mapQuote(rows[0]) : null;
};

export const restoreSnapshotQuote = async (
  id: string,
  snapshot: ClientQuoteRestoreFields,
  exec: DbExecutor = db,
): Promise<ClientQuote | null> => {
  const rows = await exec
    .update(quotes)
    .set({
      clientId: snapshot.clientId,
      clientName: snapshot.clientName,
      paymentTerms: snapshot.paymentTerms,
      discount: numericForDb(snapshot.discount),
      discountType: snapshot.discountType,
      status: snapshot.status,
      expirationDate: snapshot.expirationDate,
      notes: snapshot.notes,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(quotes.id, id))
    .returning(QUOTE_BASE_PROJECTION);
  return rows[0] ? mapQuote(rows[0]) : null;
};

export type NewClientQuoteItem = {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  productCost: number;
  productMolPercentage: number | null;
  discount: number;
  note: string | null;
  supplierQuoteId: string | null;
  supplierQuoteItemId: string | null;
  supplierQuoteSupplierName: string | null;
  supplierQuoteUnitPrice: number | null;
  unitType: UnitType;
  durationMonths: number;
  durationUnit: DurationUnit;
};

export const insertItems = async (
  quoteId: string,
  items: NewClientQuoteItem[],
  exec: DbExecutor = db,
): Promise<ClientQuoteItem[]> => {
  if (items.length === 0) return [];
  const rows = await exec
    .insert(quoteItems)
    .values(
      items.map((item) => ({
        id: item.id,
        quoteId,
        productId: item.productId,
        productName: item.productName,
        quantity: numericForDb(item.quantity),
        unitPrice: numericForDb(item.unitPrice),
        productCost: numericForDb(item.productCost),
        productMolPercentage: numericForDb(item.productMolPercentage),
        discount: numericForDb(item.discount),
        note: item.note,
        supplierQuoteId: item.supplierQuoteId,
        supplierQuoteItemId: item.supplierQuoteItemId,
        supplierQuoteSupplierName: item.supplierQuoteSupplierName,
        supplierQuoteUnitPrice: numericForDb(item.supplierQuoteUnitPrice),
        unitType: item.unitType,
        durationMonths: item.durationMonths ?? 1,
        durationUnit: item.durationUnit ?? 'months',
      })),
    )
    .returning();
  return rows.map(mapItem);
};

export const replaceItems = async (
  quoteId: string,
  items: NewClientQuoteItem[],
  exec: DbExecutor = db,
): Promise<ClientQuoteItem[]> =>
  runAtomically(exec, async (tx) => {
    await tx.delete(quoteItems).where(eq(quoteItems.quoteId, quoteId));
    return insertItems(quoteId, items, tx);
  });

export const deleteById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const result = await exec.delete(quotes).where(eq(quotes.id, id));
  return (result.rowCount ?? 0) > 0;
};
