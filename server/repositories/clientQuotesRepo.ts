import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { customerOffers } from '../db/schema/customerOffers.ts';
import { quoteItems, quotes } from '../db/schema/quotes.ts';
import { sales } from '../db/schema/sales.ts';
import { normalizeNullableDateOnly } from '../utils/date.ts';
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
};

// Correlated subquery used by list/find projections. create/update use `null::varchar`
// instead because no offer can exist yet for a freshly-written row.
const linkedOfferIdSubquery = sql<
  string | null
>`(SELECT co.id FROM customer_offers co WHERE co.linked_quote_id = ${quotes.id} AND co.is_latest = true LIMIT 1)`;

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

export const findCurrentForUpdate = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{
  status: string;
  discount: number;
  discountType: 'percentage' | 'currency';
} | null> => {
  const rows = await exec
    .select({
      status: quotes.status,
      discount: quotes.discount,
      discountType: quotes.discountType,
    })
    .from(quotes)
    .where(eq(quotes.id, id));
  if (rows.length === 0) return null;
  return {
    status: rows[0].status,
    discount: parseDbNumber(rows[0].discount, 0),
    discountType: rows[0].discountType === 'currency' ? 'currency' : 'percentage',
  };
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
    .where(and(eq(customerOffers.linkedQuoteId, quoteId), eq(customerOffers.isLatest, true)))
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
): Promise<Array<{ quantity: number; unitPrice: number; discount: number }>> => {
  const rows = await exec
    .select({
      quantity: quoteItems.quantity,
      unitPrice: quoteItems.unitPrice,
      discount: quoteItems.discount,
    })
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quoteId));
  return rows.map((row) => ({
    quantity: parseDbNumber(row.quantity, 0),
    unitPrice: parseDbNumber(row.unitPrice, 0),
    discount: parseDbNumber(row.discount, 0),
  }));
};

export const findItemsForQuote = async (
  quoteId: string,
  exec: DbExecutor = db,
): Promise<ClientQuoteItem[]> => {
  const rows = await exec.select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId));
  return rows.map(mapItem);
};

// Uses BASE projection (linkedOfferId NULL) because snapshots store on-row data only;
// the offer-link join is reconstructed on read, not frozen into history.
export const findFullForSnapshot = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ quote: ClientQuote; items: ClientQuoteItem[] } | null> => {
  const [quoteRows, items] = await Promise.all([
    exec.select(QUOTE_BASE_PROJECTION).from(quotes).where(eq(quotes.id, id)).limit(1),
    findItemsForQuote(id, exec),
  ]);
  if (quoteRows.length === 0) return null;
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
    })
    .returning(QUOTE_BASE_PROJECTION);
  return mapQuote(rows[0]);
};

export type ClientQuoteUpdate = {
  id?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  paymentTerms?: string | null;
  discount?: number | null;
  discountType?: 'percentage' | 'currency' | null;
  status?: string | null;
  expirationDate?: string | null;
  notes?: string | null;
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
      id: sql`COALESCE(${patch.id ?? null}, ${quotes.id})`,
      clientId: sql`COALESCE(${patch.clientId ?? null}, ${quotes.clientId})`,
      clientName: sql`COALESCE(${patch.clientName ?? null}, ${quotes.clientName})`,
      paymentTerms: sql`COALESCE(${patch.paymentTerms ?? null}, ${quotes.paymentTerms})`,
      discount: sql`COALESCE(${numericForDb(patch.discount) ?? null}::numeric, ${quotes.discount})`,
      discountType: sql`COALESCE(${patch.discountType ?? null}, ${quotes.discountType})`,
      status: sql`COALESCE(${patch.status ?? null}, ${quotes.status})`,
      expirationDate: sql`COALESCE(${patch.expirationDate ?? null}::date, ${quotes.expirationDate})`,
      notes: sql`COALESCE(${patch.notes ?? null}, ${quotes.notes})`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(quotes.id, id))
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
      })),
    )
    .returning();
  return rows.map(mapItem);
};

export const replaceItems = async (
  quoteId: string,
  items: NewClientQuoteItem[],
  exec: DbExecutor = db,
): Promise<ClientQuoteItem[]> => {
  await exec.delete(quoteItems).where(eq(quoteItems.quoteId, quoteId));
  return insertItems(quoteId, items, exec);
};

export const deleteById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const result = await exec.delete(quotes).where(eq(quotes.id, id));
  return (result.rowCount ?? 0) > 0;
};
