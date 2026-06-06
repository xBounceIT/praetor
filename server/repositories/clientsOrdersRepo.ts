import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { type DbExecutor, db, runAtomically } from '../db/drizzle.ts';
import { customerOffers } from '../db/schema/customerOffers.ts';
import { saleItems, sales } from '../db/schema/sales.ts';
import { supplierSaleItems, supplierSales } from '../db/schema/supplierSales.ts';
import { type DurationUnit, normalizeDurationUnit } from '../utils/duration-unit.ts';
import { numericForDb, parseDbNumber, parseNullableDbNumber } from '../utils/parse.ts';
import { normalizeUnitType, type UnitType } from '../utils/unit-type.ts';

export type ClientOrder = {
  id: string;
  linkedQuoteId: string | null;
  linkedOfferId: string | null;
  clientId: string;
  clientName: string;
  paymentTerms: string | null;
  discount: number;
  discountType: 'percentage' | 'currency';
  status: string;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ClientOrderItem = {
  id: string;
  orderId: string;
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
  supplierSaleId: string | null;
  supplierSaleItemId: string | null;
  supplierSaleSupplierName: string | null;
  unitType: UnitType;
  note: string | null;
  discount: number;
  durationMonths: number;
  durationUnit: DurationUnit;
};

const mapOrder = (row: typeof sales.$inferSelect): ClientOrder => ({
  id: row.id,
  linkedQuoteId: row.linkedQuoteId,
  linkedOfferId: row.linkedOfferId,
  clientId: row.clientId,
  clientName: row.clientName,
  paymentTerms: row.paymentTerms,
  discount: parseDbNumber(row.discount, 0),
  discountType: row.discountType === 'currency' ? 'currency' : 'percentage',
  status: row.status,
  notes: row.notes,
  createdAt: row.createdAt?.getTime() ?? 0,
  updatedAt: row.updatedAt?.getTime() ?? 0,
});

// `sale_items.sale_id` is exposed as `orderId` in the domain type - public API contract.
const mapItem = (row: typeof saleItems.$inferSelect): ClientOrderItem => ({
  id: row.id,
  orderId: row.saleId,
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
  supplierSaleId: row.supplierSaleId,
  supplierSaleItemId: row.supplierSaleItemId,
  supplierSaleSupplierName: row.supplierSaleSupplierName,
  unitType: normalizeUnitType(row.unitType),
  note: row.note,
  discount: parseDbNumber(row.discount, 0),
  durationMonths: row.durationMonths ?? 1,
  durationUnit: normalizeDurationUnit(row.durationUnit),
});

export const listAll = async (exec: DbExecutor = db): Promise<ClientOrder[]> => {
  const rows = await exec.select().from(sales).orderBy(desc(sales.createdAt));
  return rows.map(mapOrder);
};

export const listAllItems = async (exec: DbExecutor = db): Promise<ClientOrderItem[]> => {
  const rows = await exec.select().from(saleItems).orderBy(saleItems.createdAt);
  return rows.map(mapItem);
};

export const existsById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const rows = await exec.select({ id: sales.id }).from(sales).where(eq(sales.id, id));
  return rows.length > 0;
};

export const findClientIdById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<string | null> => {
  const rows = await exec.select({ clientId: sales.clientId }).from(sales).where(eq(sales.id, id));
  return rows[0]?.clientId ?? null;
};

export const findIdConflict = async (
  newId: string,
  currentId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const rows = await exec
    .select({ id: sales.id })
    .from(sales)
    .where(and(eq(sales.id, newId), ne(sales.id, currentId)));
  return rows.length > 0;
};

export type ExistingClientOrder = {
  id: string;
  linkedQuoteId: string | null;
  linkedOfferId: string | null;
  clientId: string;
  clientName: string;
  paymentTerms: string | null;
  discount: number;
  discountType: 'percentage' | 'currency';
  status: string;
  notes: string | null;
};

// Reads the minimal set of fields needed to gate updates / restores. Named `findExisting`
// (not `findForUpdate`) because it does not acquire a row lock - callers run the read,
// validate, and then issue a separate UPDATE outside any locking scope. If you need true
// SELECT ... FOR UPDATE semantics, wrap in `withDbTransaction` and add `.for('update')`.
export const findExisting = async (
  id: string,
  exec: DbExecutor = db,
): Promise<ExistingClientOrder | null> => {
  const rows = await exec
    .select({
      id: sales.id,
      linkedQuoteId: sales.linkedQuoteId,
      linkedOfferId: sales.linkedOfferId,
      clientId: sales.clientId,
      clientName: sales.clientName,
      paymentTerms: sales.paymentTerms,
      discount: sales.discount,
      discountType: sales.discountType,
      status: sales.status,
      notes: sales.notes,
    })
    .from(sales)
    .where(eq(sales.id, id));
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    linkedQuoteId: rows[0].linkedQuoteId,
    linkedOfferId: rows[0].linkedOfferId,
    clientId: rows[0].clientId,
    clientName: rows[0].clientName,
    paymentTerms: rows[0].paymentTerms,
    discount: parseDbNumber(rows[0].discount, 0),
    discountType: rows[0].discountType === 'currency' ? 'currency' : 'percentage',
    status: rows[0].status,
    notes: rows[0].notes,
  };
};

export const findStatusAndClientName = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ status: string; clientName: string } | null> => {
  const rows = await exec
    .select({ status: sales.status, clientName: sales.clientName })
    .from(sales)
    .where(eq(sales.id, id));
  return rows[0] ?? null;
};

export type OfferLink = {
  id: string;
  linkedQuoteId: string | null;
  status: string;
};

export const findOfferDetails = async (
  offerId: string,
  exec: DbExecutor = db,
): Promise<OfferLink | null> => {
  const rows = await exec
    .select({
      id: customerOffers.id,
      linkedQuoteId: customerOffers.linkedQuoteId,
      status: customerOffers.status,
    })
    .from(customerOffers)
    .where(eq(customerOffers.id, offerId));
  return rows[0] ?? null;
};

export const findExistingForOffer = async (
  offerId: string,
  excludeOrderId: string | null = null,
  exec: DbExecutor = db,
): Promise<string | null> => {
  // Drizzle's `and(...)` filters out `undefined` so the conditional clause appears only when
  // `excludeOrderId` is provided.
  const rows = await exec
    .select({ id: sales.id })
    .from(sales)
    .where(
      and(
        eq(sales.linkedOfferId, offerId),
        excludeOrderId ? ne(sales.id, excludeOrderId) : undefined,
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
};

export const findItemsForOrder = async (
  orderId: string,
  exec: DbExecutor = db,
): Promise<ClientOrderItem[]> => {
  const rows = await exec
    .select()
    .from(saleItems)
    .where(eq(saleItems.saleId, orderId))
    .orderBy(asc(saleItems.createdAt), asc(saleItems.id));
  return rows.map(mapItem);
};

export const findFullForSnapshot = async (
  orderId: string,
  exec: DbExecutor = db,
): Promise<{ order: ClientOrder; items: ClientOrderItem[] } | null> => {
  const orderRows = await exec.select().from(sales).where(eq(sales.id, orderId)).limit(1);
  if (orderRows.length === 0) return null;
  const items = await findItemsForOrder(orderId, exec);
  return { order: mapOrder(orderRows[0]), items };
};

export type NewClientOrder = {
  id: string;
  linkedQuoteId: string | null;
  linkedOfferId: string | null;
  clientId: string;
  clientName: string;
  paymentTerms: string;
  discount: number;
  discountType: 'percentage' | 'currency';
  status: string;
  notes: string | null;
};

export const create = async (
  input: NewClientOrder,
  exec: DbExecutor = db,
): Promise<ClientOrder> => {
  const rows = await exec
    .insert(sales)
    .values({
      id: input.id,
      linkedQuoteId: input.linkedQuoteId,
      linkedOfferId: input.linkedOfferId,
      clientId: input.clientId,
      clientName: input.clientName,
      paymentTerms: input.paymentTerms,
      discount: numericForDb(input.discount),
      discountType: input.discountType,
      status: input.status,
      notes: input.notes,
    })
    .returning();
  return mapOrder(rows[0]);
};

export type ClientOrderUpdate = {
  linkedOfferId?: string | null;
  linkedQuoteId?: string | null;
  clientId?: string;
  clientName?: string;
  paymentTerms?: string;
  discount?: number;
  discountType?: 'percentage' | 'currency';
  status?: string;
  notes?: string | null;
};

const orderUpdateValues = (patch: ClientOrderUpdate) => {
  const set: Record<string, unknown> = {};
  if (patch.linkedOfferId !== undefined) set.linkedOfferId = patch.linkedOfferId;
  if (patch.linkedQuoteId !== undefined) set.linkedQuoteId = patch.linkedQuoteId;
  if (patch.clientId !== undefined) set.clientId = patch.clientId;
  if (patch.clientName !== undefined) set.clientName = patch.clientName;
  if (patch.paymentTerms !== undefined) set.paymentTerms = patch.paymentTerms;
  if (patch.discount !== undefined) set.discount = numericForDb(patch.discount);
  if (patch.discountType !== undefined) set.discountType = patch.discountType;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.notes !== undefined) set.notes = patch.notes;
  set.updatedAt = sql`CURRENT_TIMESTAMP`;
  return set;
};

export const update = async (
  id: string,
  patch: ClientOrderUpdate,
  exec: DbExecutor = db,
): Promise<ClientOrder | null> => {
  const rows = await exec
    .update(sales)
    .set(orderUpdateValues(patch))
    .where(eq(sales.id, id))
    .returning();
  return rows[0] ? mapOrder(rows[0]) : null;
};

// Separate from update() so generic patches can't mutate the PK (issue #621). Relies on
// ON UPDATE CASCADE on every incoming FK; see server/test/db/renamablePkFkCascade.test.ts.
export const rename = async (
  currentId: string,
  newId: string,
  exec: DbExecutor = db,
): Promise<ClientOrder | null> => {
  const rows = await exec
    .update(sales)
    .set({ id: newId, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(sales.id, currentId))
    .returning();
  return rows[0] ? mapOrder(rows[0]) : null;
};

// `linkedQuoteId` / `linkedOfferId` are optional: snapshots predating this change don't carry
// them, in which case we preserve whatever is currently on the row (no-op on those columns).
export type ClientOrderRestoreFields = Pick<
  ClientOrder,
  'clientId' | 'clientName' | 'paymentTerms' | 'discount' | 'discountType' | 'status' | 'notes'
> & {
  linkedQuoteId?: string | null;
  linkedOfferId?: string | null;
};

export const restoreSnapshotOrder = async (
  id: string,
  snapshot: ClientOrderRestoreFields,
  exec: DbExecutor = db,
): Promise<ClientOrder | null> => {
  const baseFields = {
    clientId: snapshot.clientId,
    clientName: snapshot.clientName,
    paymentTerms: snapshot.paymentTerms ?? 'immediate',
    discount: numericForDb(snapshot.discount),
    discountType: snapshot.discountType,
    status: snapshot.status,
    notes: snapshot.notes,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  };
  // Only overwrite linkedQuoteId/linkedOfferId when the snapshot explicitly carries them
  // (legacy snapshots stored these as undefined; overwriting with `null` would wipe a link
  // that is still valid on the live row).
  const linkedFields: { linkedQuoteId?: string | null; linkedOfferId?: string | null } = {};
  if (Object.hasOwn(snapshot, 'linkedQuoteId')) {
    linkedFields.linkedQuoteId = snapshot.linkedQuoteId ?? null;
  }
  if (Object.hasOwn(snapshot, 'linkedOfferId')) {
    linkedFields.linkedOfferId = snapshot.linkedOfferId ?? null;
  }
  const rows = await exec
    .update(sales)
    .set({ ...baseFields, ...linkedFields })
    .where(eq(sales.id, id))
    .returning();
  return rows[0] ? mapOrder(rows[0]) : null;
};

// `productId` is required because `sale_items.product_id` is NOT NULL with an FK to
// `products(id)`. Substituting a sentinel like '' would just trade a NOT NULL violation for an
// FK violation, so callers must resolve a real product id before calling.
export type NewClientOrderItem = {
  id: string;
  productId: string;
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
  supplierSaleId: string | null;
  supplierSaleItemId: string | null;
  supplierSaleSupplierName: string | null;
  unitType: UnitType;
  durationMonths: number;
  durationUnit: DurationUnit;
};

export const insertItems = async (
  orderId: string,
  items: NewClientOrderItem[],
  exec: DbExecutor = db,
): Promise<ClientOrderItem[]> => {
  if (items.length === 0) return [];
  const rows = await exec
    .insert(saleItems)
    .values(
      items.map((item) => ({
        id: item.id,
        saleId: orderId,
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
        supplierSaleId: item.supplierSaleId,
        supplierSaleItemId: item.supplierSaleItemId,
        supplierSaleSupplierName: item.supplierSaleSupplierName,
        unitType: item.unitType,
        durationMonths: item.durationMonths ?? 1,
        durationUnit: item.durationUnit ?? 'months',
      })),
    )
    .returning();
  return rows.map(mapItem);
};

export const replaceItems = async (
  orderId: string,
  items: NewClientOrderItem[],
  exec: DbExecutor = db,
): Promise<ClientOrderItem[]> =>
  runAtomically(exec, async (tx) => {
    await tx.delete(saleItems).where(eq(saleItems.saleId, orderId));
    return insertItems(orderId, items, tx);
  });

export const deleteById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const result = await exec.delete(sales).where(eq(sales.id, id));
  return (result.rowCount ?? 0) > 0;
};

export type NewSupplierOrderForAutoCreate = {
  id: string;
  linkedQuoteId: string;
  supplierId: string;
  supplierName: string;
  paymentTerms: string;
  notes: string | null;
};

export const createSupplierOrder = async (
  input: NewSupplierOrderForAutoCreate,
  exec: DbExecutor,
): Promise<void> => {
  await exec.insert(supplierSales).values({
    id: input.id,
    linkedQuoteId: input.linkedQuoteId,
    supplierId: input.supplierId,
    supplierName: input.supplierName,
    paymentTerms: input.paymentTerms,
    status: 'draft',
    notes: input.notes,
  });
};

export type NewSupplierOrderItemForAutoCreate = {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  note: string | null;
};

export const bulkInsertSupplierOrderItems = async (
  supplierOrderId: string,
  items: NewSupplierOrderItemForAutoCreate[],
  exec: DbExecutor,
): Promise<void> => {
  if (items.length === 0) return;
  await exec.insert(supplierSaleItems).values(
    items.map((item) => ({
      id: item.id,
      saleId: supplierOrderId,
      productId: item.productId,
      productName: item.productName,
      quantity: numericForDb(item.quantity),
      unitPrice: numericForDb(item.unitPrice),
      note: item.note,
    })),
  );
};

export const linkSaleItemsToSupplierOrder = async (
  args: {
    orderId: string;
    supplierQuoteId: string;
    supplierOrderId: string;
    supplierName: string;
  },
  exec: DbExecutor,
): Promise<void> => {
  await exec
    .update(saleItems)
    .set({
      supplierSaleId: args.supplierOrderId,
      supplierSaleSupplierName: args.supplierName,
    })
    .where(
      and(eq(saleItems.saleId, args.orderId), eq(saleItems.supplierQuoteId, args.supplierQuoteId)),
    );
};

export const mapSaleItemsToSupplierItems = async (
  args: {
    orderId: string;
    supplierQuoteId: string;
    mappings: Array<{ quoteItemId: string; saleItemId: string }>;
  },
  exec: DbExecutor,
): Promise<void> => {
  if (args.mappings.length === 0) return;
  const valuesTuples = args.mappings.map((m) => sql`(${m.quoteItemId}, ${m.saleItemId})`);
  await exec.execute(
    sql`UPDATE sale_items si
        SET supplier_sale_item_id = v.sale_item_id
      FROM (VALUES ${sql.join(valuesTuples, sql`, `)}) v(quote_item_id, sale_item_id)
      WHERE si.sale_id = ${args.orderId}
        AND si.supplier_quote_id = ${args.supplierQuoteId}
        AND si.supplier_quote_item_id = v.quote_item_id`,
  );
};
