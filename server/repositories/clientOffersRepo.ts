import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
import { customerOfferItems } from '../db/schema/customerOfferItems.ts';
import { customerOffers } from '../db/schema/customerOffers.ts';
import { sales } from '../db/schema/sales.ts';
import { normalizeNullableDateOnly } from '../utils/date.ts';
import { parseDbNumber, parseNullableDbNumber } from '../utils/parse.ts';
import { normalizeUnitType, type UnitType } from '../utils/unit-type.ts';

export type ClientOffer = {
  id: string;
  linkedQuoteId: string;
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

export type ClientOfferItem = {
  id: string;
  offerId: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  productCost: number;
  productMolPercentage: number | null;
  supplierQuoteId: string | null;
  supplierQuoteItemId: string | null;
  supplierQuoteSupplierName: string | null;
  supplierQuoteUnitPrice: number | null;
  unitType: UnitType;
  note: string | null;
  discount: number;
};

// Snake-case-aliased shape returned by raw-SQL `executeRows` paths (`update`, `insertItems`).
// The SELECT clauses below alias columns to camelCase via `AS "fooBar"`, so these row shapes
// are camelCase as well — the difference vs. builder rows is that timestamp columns come back
// as epoch-ms numbers (via `EXTRACT(EPOCH FROM ...) * 1000`) rather than `Date` objects.
type ClientOfferRow = {
  id: string;
  linkedQuoteId: string;
  clientId: string;
  clientName: string;
  paymentTerms: string | null;
  discount: string | number;
  discountType: string;
  status: string;
  expirationDate: string | Date | null;
  notes: string | null;
  createdAt: string | number;
  updatedAt: string | number;
};

type ClientOfferItemRow = {
  id: string;
  offerId: string;
  productId: string | null;
  productName: string;
  quantity: string | number;
  unitPrice: string | number;
  productCost: string | number;
  productMolPercentage: string | number | null;
  supplierQuoteId: string | null;
  supplierQuoteItemId: string | null;
  supplierQuoteSupplierName: string | null;
  supplierQuoteUnitPrice: string | number | null;
  unitType: string | null;
  note: string | null;
  discount: string | number;
};

const OFFER_RETURNING_SQL = sql`
  id,
  linked_quote_id as "linkedQuoteId",
  client_id as "clientId",
  client_name as "clientName",
  payment_terms as "paymentTerms",
  discount,
  discount_type as "discountType",
  status,
  expiration_date as "expirationDate",
  notes,
  EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
  EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"
`;

const ITEM_RETURNING_SQL = sql`
  id,
  offer_id as "offerId",
  product_id as "productId",
  product_name as "productName",
  quantity,
  unit_price as "unitPrice",
  product_cost as "productCost",
  product_mol_percentage as "productMolPercentage",
  supplier_quote_id as "supplierQuoteId",
  supplier_quote_item_id as "supplierQuoteItemId",
  supplier_quote_supplier_name as "supplierQuoteSupplierName",
  supplier_quote_unit_price as "supplierQuoteUnitPrice",
  unit_type as "unitType",
  note,
  discount
`;

const mapOffer = (row: ClientOfferRow): ClientOffer => ({
  id: row.id,
  linkedQuoteId: row.linkedQuoteId,
  clientId: row.clientId,
  clientName: row.clientName,
  paymentTerms: row.paymentTerms,
  discount: parseDbNumber(row.discount, 0),
  discountType: row.discountType === 'currency' ? 'currency' : 'percentage',
  status: row.status,
  expirationDate: normalizeNullableDateOnly(row.expirationDate, 'offer.expirationDate'),
  notes: row.notes,
  createdAt: parseDbNumber(row.createdAt, 0),
  updatedAt: parseDbNumber(row.updatedAt, 0),
});

const mapBuilderOffer = (row: typeof customerOffers.$inferSelect): ClientOffer => ({
  id: row.id,
  linkedQuoteId: row.linkedQuoteId,
  clientId: row.clientId,
  clientName: row.clientName,
  paymentTerms: row.paymentTerms,
  discount: parseDbNumber(row.discount, 0),
  discountType: row.discountType === 'currency' ? 'currency' : 'percentage',
  status: row.status,
  expirationDate: normalizeNullableDateOnly(row.expirationDate, 'offer.expirationDate'),
  notes: row.notes,
  createdAt: row.createdAt?.getTime() ?? 0,
  updatedAt: row.updatedAt?.getTime() ?? 0,
});

const mapItem = (row: ClientOfferItemRow): ClientOfferItem => ({
  id: row.id,
  offerId: row.offerId,
  productId: row.productId,
  productName: row.productName,
  quantity: parseDbNumber(row.quantity, 0),
  unitPrice: parseDbNumber(row.unitPrice, 0),
  productCost: parseDbNumber(row.productCost, 0),
  productMolPercentage: parseNullableDbNumber(row.productMolPercentage),
  supplierQuoteId: row.supplierQuoteId,
  supplierQuoteItemId: row.supplierQuoteItemId,
  supplierQuoteSupplierName: row.supplierQuoteSupplierName,
  supplierQuoteUnitPrice: parseNullableDbNumber(row.supplierQuoteUnitPrice),
  unitType: normalizeUnitType(row.unitType),
  note: row.note,
  discount: parseDbNumber(row.discount, 0),
});

const mapBuilderItem = (row: typeof customerOfferItems.$inferSelect): ClientOfferItem => ({
  id: row.id,
  offerId: row.offerId,
  productId: row.productId,
  productName: row.productName,
  quantity: parseDbNumber(row.quantity, 0),
  unitPrice: parseDbNumber(row.unitPrice, 0),
  productCost: parseDbNumber(row.productCost, 0),
  productMolPercentage: parseNullableDbNumber(row.productMolPercentage),
  supplierQuoteId: row.supplierQuoteId,
  supplierQuoteItemId: row.supplierQuoteItemId,
  supplierQuoteSupplierName: row.supplierQuoteSupplierName,
  supplierQuoteUnitPrice: parseNullableDbNumber(row.supplierQuoteUnitPrice),
  unitType: normalizeUnitType(row.unitType),
  note: row.note,
  discount: parseDbNumber(row.discount, 0),
});

export const listAll = async (exec: DbExecutor = db): Promise<ClientOffer[]> => {
  const rows = await exec.select().from(customerOffers).orderBy(desc(customerOffers.createdAt));
  return rows.map(mapBuilderOffer);
};

export const listAllItems = async (exec: DbExecutor = db): Promise<ClientOfferItem[]> => {
  const rows = await exec
    .select()
    .from(customerOfferItems)
    .orderBy(asc(customerOfferItems.createdAt));
  return rows.map(mapBuilderItem);
};

export const existsById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const rows = await exec
    .select({ id: customerOffers.id })
    .from(customerOffers)
    .where(eq(customerOffers.id, id));
  return rows.length > 0;
};

export const findIdConflict = async (
  newId: string,
  currentId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const rows = await exec
    .select({ id: customerOffers.id })
    .from(customerOffers)
    .where(and(eq(customerOffers.id, newId), ne(customerOffers.id, currentId)));
  return rows.length > 0;
};

export type ExistingOffer = {
  id: string;
  linkedQuoteId: string | null;
  clientId: string;
  clientName: string;
  status: string;
};

export const findForUpdate = async (
  id: string,
  exec: DbExecutor = db,
): Promise<ExistingOffer | null> => {
  const rows = await exec
    .select({
      id: customerOffers.id,
      linkedQuoteId: customerOffers.linkedQuoteId,
      clientId: customerOffers.clientId,
      clientName: customerOffers.clientName,
      status: customerOffers.status,
    })
    .from(customerOffers)
    .where(eq(customerOffers.id, id));
  return rows[0] ?? null;
};

export const findStatusAndClientName = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ status: string; clientName: string } | null> => {
  const rows = await exec
    .select({ status: customerOffers.status, clientName: customerOffers.clientName })
    .from(customerOffers)
    .where(eq(customerOffers.id, id));
  return rows[0] ?? null;
};

export const findExistingForQuote = async (
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

export const findLinkedSaleId = async (
  offerId: string,
  exec: DbExecutor = db,
): Promise<string | null> => {
  const rows = await exec
    .select({ id: sales.id })
    .from(sales)
    .where(eq(sales.linkedOfferId, offerId))
    .limit(1);
  return rows[0]?.id ?? null;
};

export const findItemsForOffer = async (
  offerId: string,
  exec: DbExecutor = db,
): Promise<ClientOfferItem[]> => {
  const rows = await exec
    .select()
    .from(customerOfferItems)
    .where(eq(customerOfferItems.offerId, offerId));
  return rows.map(mapBuilderItem);
};

export type NewClientOffer = {
  id: string;
  linkedQuoteId: string;
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
  input: NewClientOffer,
  exec: DbExecutor = db,
): Promise<ClientOffer> => {
  const [row] = await exec
    .insert(customerOffers)
    .values({
      id: input.id,
      linkedQuoteId: input.linkedQuoteId,
      clientId: input.clientId,
      clientName: input.clientName,
      paymentTerms: input.paymentTerms,
      // numeric columns accept number or string at the wire level; the schema's TS
      // type is `string` so cast through. The pg driver serializes both equivalently.
      discount: input.discount as unknown as string,
      discountType: input.discountType,
      status: input.status,
      expirationDate: input.expirationDate,
      notes: input.notes,
    })
    .returning();
  return mapBuilderOffer(row);
};

export type ClientOfferUpdate = {
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

export const update = async (
  id: string,
  patch: ClientOfferUpdate,
  exec: DbExecutor = db,
): Promise<ClientOffer | null> => {
  // The COALESCE pattern preserves the existing column when the patch field is null —
  // matches the pre-Drizzle contract callers rely on (the client-offers route always
  // passes a value, using `null` to mean "keep existing" for fields that weren't sent).
  const rows = await executeRows<ClientOfferRow>(
    exec,
    sql`UPDATE customer_offers
           SET id = COALESCE(${patch.id ?? null}, id),
               client_id = COALESCE(${patch.clientId ?? null}, client_id),
               client_name = COALESCE(${patch.clientName ?? null}, client_name),
               payment_terms = COALESCE(${patch.paymentTerms ?? null}, payment_terms),
               discount = COALESCE(${patch.discount ?? null}, discount),
               discount_type = COALESCE(${patch.discountType ?? null}, discount_type),
               status = COALESCE(${patch.status ?? null}, status),
               expiration_date = COALESCE(${patch.expirationDate ?? null}, expiration_date),
               notes = COALESCE(${patch.notes ?? null}, notes),
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ${id}
         RETURNING ${OFFER_RETURNING_SQL}`,
  );
  return rows[0] ? mapOffer(rows[0]) : null;
};

export type NewClientOfferItem = {
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
  offerId: string,
  items: NewClientOfferItem[],
  exec: DbExecutor = db,
): Promise<ClientOfferItem[]> => {
  if (items.length === 0) return [];
  // Multi-row INSERT via `sql.join` of per-row tuples. Drizzle's tagged template handles
  // parameter numbering; preserves the existing single-statement bulk insert.
  const valuesTuples = items.map(
    (item) =>
      sql`(${item.id}, ${offerId}, ${item.productId}, ${item.productName}, ${item.quantity}, ${item.unitPrice}, ${item.productCost}, ${item.productMolPercentage}, ${item.discount}, ${item.note}, ${item.supplierQuoteId}, ${item.supplierQuoteItemId}, ${item.supplierQuoteSupplierName}, ${item.supplierQuoteUnitPrice}, ${item.unitType})`,
  );
  const rows = await executeRows<ClientOfferItemRow>(
    exec,
    sql`INSERT INTO customer_offer_items
           (id, offer_id, product_id, product_name, quantity, unit_price, product_cost,
            product_mol_percentage, discount, note,
            supplier_quote_id, supplier_quote_item_id, supplier_quote_supplier_name,
            supplier_quote_unit_price, unit_type)
         VALUES ${sql.join(valuesTuples, sql`, `)}
         RETURNING ${ITEM_RETURNING_SQL}`,
  );
  return rows.map(mapItem);
};

export const replaceItems = async (
  offerId: string,
  items: NewClientOfferItem[],
  exec: DbExecutor = db,
): Promise<ClientOfferItem[]> => {
  await exec.delete(customerOfferItems).where(eq(customerOfferItems.offerId, offerId));
  return insertItems(offerId, items, exec);
};

export const deleteById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const result = await exec.delete(customerOffers).where(eq(customerOffers.id, id));
  return (result.rowCount ?? 0) > 0;
};
