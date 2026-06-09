import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { type DbExecutor, db, runAtomically } from '../db/drizzle.ts';
import { customerOfferItems } from '../db/schema/customerOfferItems.ts';
import { customerOffers } from '../db/schema/customerOffers.ts';
import { sales } from '../db/schema/sales.ts';
import { normalizeNullableDateOnly } from '../utils/date.ts';
import { type DurationUnit, normalizeDurationUnit } from '../utils/duration-unit.ts';
import { numericForDb, parseDbNumber, parseNullableDbNumber } from '../utils/parse.ts';
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
  deliveryDate: string | null;
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
  durationMonths: number;
  durationUnit: DurationUnit;
};

const mapOffer = (row: typeof customerOffers.$inferSelect): ClientOffer => ({
  id: row.id,
  linkedQuoteId: row.linkedQuoteId,
  clientId: row.clientId,
  clientName: row.clientName,
  paymentTerms: row.paymentTerms,
  discount: parseDbNumber(row.discount, 0),
  discountType: row.discountType === 'currency' ? 'currency' : 'percentage',
  status: row.status,
  deliveryDate: normalizeNullableDateOnly(row.deliveryDate, 'offer.deliveryDate'),
  expirationDate: normalizeNullableDateOnly(row.expirationDate, 'offer.expirationDate'),
  notes: row.notes,
  createdAt: row.createdAt?.getTime() ?? 0,
  updatedAt: row.updatedAt?.getTime() ?? 0,
});

const mapItem = (row: typeof customerOfferItems.$inferSelect): ClientOfferItem => ({
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
  durationMonths: row.durationMonths ?? 1,
  durationUnit: normalizeDurationUnit(row.durationUnit),
});

export const listAll = async (exec: DbExecutor = db): Promise<ClientOffer[]> => {
  const rows = await exec.select().from(customerOffers).orderBy(desc(customerOffers.createdAt));
  return rows.map(mapOffer);
};

export const listAllItems = async (exec: DbExecutor = db): Promise<ClientOfferItem[]> => {
  const rows = await exec
    .select()
    .from(customerOfferItems)
    .orderBy(asc(customerOfferItems.createdAt), asc(customerOfferItems.id));
  return rows.map(mapItem);
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
  deliveryDate: string | null;
  // Needed by the #779 expired guards: the derived `expired` status comes from this date.
  expirationDate: string;
};

// Reads the minimal set of fields needed to gate updates / restores. Does not acquire a row
// lock - safe for non-mutating reads, but TOCTOU-prone when a write decision depends on it.
// For SELECT ... FOR UPDATE semantics call `lockExistingById` inside `withDbTransaction`.
export const findExisting = async (
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
      deliveryDate: customerOffers.deliveryDate,
      expirationDate: customerOffers.expirationDate,
    })
    .from(customerOffers)
    .where(eq(customerOffers.id, id));
  return rows[0] ?? null;
};

// SELECT ... FOR UPDATE variant of `findExisting`. Must be called inside a transaction.
export const lockExistingById = async (
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
      deliveryDate: customerOffers.deliveryDate,
      expirationDate: customerOffers.expirationDate,
    })
    .from(customerOffers)
    .where(eq(customerOffers.id, id))
    .for('update');
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

export const findClientIdById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<string | null> => {
  const rows = await exec
    .select({ clientId: customerOffers.clientId })
    .from(customerOffers)
    .where(eq(customerOffers.id, id));
  return rows[0]?.clientId ?? null;
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
    .where(eq(customerOfferItems.offerId, offerId))
    .orderBy(asc(customerOfferItems.createdAt), asc(customerOfferItems.id));
  return rows.map(mapItem);
};

export const findFullForSnapshot = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ offer: ClientOffer; items: ClientOfferItem[] } | null> => {
  const offerRows = await exec
    .select()
    .from(customerOffers)
    .where(eq(customerOffers.id, id))
    .limit(1);
  if (offerRows.length === 0) return null;
  const items = await findItemsForOffer(id, exec);
  return { offer: mapOffer(offerRows[0]), items };
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
  deliveryDate?: string | null;
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
      discount: numericForDb(input.discount),
      discountType: input.discountType,
      status: input.status,
      deliveryDate: input.deliveryDate ?? null,
      expirationDate: input.expirationDate,
      notes: input.notes,
    })
    .returning();
  return mapOffer(row);
};

export type ClientOfferUpdate = {
  clientId?: string | null;
  clientName?: string | null;
  paymentTerms?: string | null;
  discount?: number | null;
  discountType?: 'percentage' | 'currency' | null;
  status?: string | null;
  deliveryDate?: string | null;
  expirationDate?: string | null;
  notes?: string | null;
};

export type ClientOfferRestoreFields = Pick<
  ClientOffer,
  'clientId' | 'clientName' | 'discount' | 'discountType' | 'status' | 'notes'
> & {
  paymentTerms: string;
  deliveryDate: string | null;
  expirationDate: string;
};

export const restoreSnapshotOffer = async (
  id: string,
  snapshot: ClientOfferRestoreFields,
  exec: DbExecutor = db,
): Promise<ClientOffer | null> => {
  const [row] = await exec
    .update(customerOffers)
    .set({
      clientId: snapshot.clientId,
      clientName: snapshot.clientName,
      paymentTerms: snapshot.paymentTerms,
      discount: numericForDb(snapshot.discount),
      discountType: snapshot.discountType,
      status: snapshot.status,
      deliveryDate: snapshot.deliveryDate,
      expirationDate: snapshot.expirationDate,
      notes: snapshot.notes,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(customerOffers.id, id))
    .returning();
  return row ? mapOffer(row) : null;
};

export const update = async (
  id: string,
  patch: ClientOfferUpdate,
  exec: DbExecutor = db,
): Promise<ClientOffer | null> => {
  const [row] = await exec
    .update(customerOffers)
    .set({
      clientId: sql`COALESCE(${patch.clientId ?? null}, ${customerOffers.clientId})`,
      clientName: sql`COALESCE(${patch.clientName ?? null}, ${customerOffers.clientName})`,
      paymentTerms: sql`COALESCE(${patch.paymentTerms ?? null}, ${customerOffers.paymentTerms})`,
      discount: sql`COALESCE(${numericForDb(patch.discount) ?? null}::numeric, ${customerOffers.discount})`,
      discountType: sql`COALESCE(${patch.discountType ?? null}, ${customerOffers.discountType})`,
      status: sql`COALESCE(${patch.status ?? null}, ${customerOffers.status})`,
      deliveryDate: sql`COALESCE(${patch.deliveryDate ?? null}::date, ${customerOffers.deliveryDate})`,
      expirationDate: sql`COALESCE(${patch.expirationDate ?? null}::date, ${customerOffers.expirationDate})`,
      notes: sql`COALESCE(${patch.notes ?? null}, ${customerOffers.notes})`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(customerOffers.id, id))
    .returning();
  return row ? mapOffer(row) : null;
};

// Separate from update() so generic patches can't mutate the PK (issue #621). Relies on
// ON UPDATE CASCADE on every incoming FK; see server/test/db/renamablePkFkCascade.test.ts.
export const rename = async (
  currentId: string,
  newId: string,
  exec: DbExecutor = db,
): Promise<ClientOffer | null> => {
  const [row] = await exec
    .update(customerOffers)
    .set({ id: newId, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(customerOffers.id, currentId))
    .returning();
  return row ? mapOffer(row) : null;
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
  durationMonths: number;
  durationUnit: DurationUnit;
};

export const insertItems = async (
  offerId: string,
  items: NewClientOfferItem[],
  exec: DbExecutor = db,
): Promise<ClientOfferItem[]> => {
  if (items.length === 0) return [];
  const rows = await exec
    .insert(customerOfferItems)
    .values(
      items.map((item) => ({
        id: item.id,
        offerId,
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
  offerId: string,
  items: NewClientOfferItem[],
  exec: DbExecutor = db,
): Promise<ClientOfferItem[]> =>
  runAtomically(exec, async (tx) => {
    await tx.delete(customerOfferItems).where(eq(customerOfferItems.offerId, offerId));
    return insertItems(offerId, items, tx);
  });

export const deleteById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const result = await exec.delete(customerOffers).where(eq(customerOffers.id, id));
  return (result.rowCount ?? 0) > 0;
};
