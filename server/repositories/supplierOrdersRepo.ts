import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { supplierInvoices } from '../db/schema/supplierInvoices.ts';
import { supplierSaleItems, supplierSales } from '../db/schema/supplierSales.ts';
import { numericForDb, parseDbNumber } from '../utils/parse.ts';

export type SupplierOrder = {
  id: string;
  linkedQuoteId: string | null;
  supplierId: string;
  supplierName: string;
  paymentTerms: string | null;
  discount: number;
  discountType: 'percentage' | 'currency';
  status: string;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
};

export type SupplierOrderItem = {
  id: string;
  orderId: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  note: string | null;
};

const mapOrder = (row: typeof supplierSales.$inferSelect): SupplierOrder => ({
  id: row.id,
  linkedQuoteId: row.linkedQuoteId,
  supplierId: row.supplierId,
  supplierName: row.supplierName,
  paymentTerms: row.paymentTerms,
  discount: parseDbNumber(row.discount, 0),
  discountType: row.discountType === 'currency' ? 'currency' : 'percentage',
  status: row.status,
  notes: row.notes,
  createdAt: row.createdAt?.getTime() ?? 0,
  updatedAt: row.updatedAt?.getTime() ?? 0,
});

const mapItem = (row: typeof supplierSaleItems.$inferSelect): SupplierOrderItem => ({
  id: row.id,
  orderId: row.saleId,
  productId: row.productId,
  productName: row.productName,
  quantity: parseDbNumber(row.quantity, 0),
  unitPrice: parseDbNumber(row.unitPrice, 0),
  discount: parseDbNumber(row.discount, 0),
  note: row.note,
});

export const listAll = async (exec: DbExecutor = db): Promise<SupplierOrder[]> => {
  const rows = await exec.select().from(supplierSales).orderBy(desc(supplierSales.createdAt));
  return rows.map(mapOrder);
};

export const listAllItems = async (exec: DbExecutor = db): Promise<SupplierOrderItem[]> => {
  const rows = await exec
    .select()
    .from(supplierSaleItems)
    .orderBy(asc(supplierSaleItems.createdAt));
  return rows.map(mapItem);
};

export const findById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<SupplierOrder | null> => {
  const rows = await exec.select().from(supplierSales).where(eq(supplierSales.id, id));
  return rows[0] ? mapOrder(rows[0]) : null;
};

export const existsById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const rows = await exec
    .select({ id: supplierSales.id })
    .from(supplierSales)
    .where(eq(supplierSales.id, id))
    .limit(1);
  return rows.length > 0;
};

export const findFullForSnapshot = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ order: SupplierOrder; items: SupplierOrderItem[] } | null> => {
  const [orderRows, items] = await Promise.all([
    exec.select().from(supplierSales).where(eq(supplierSales.id, id)).limit(1),
    findItemsForOrder(id, exec),
  ]);
  if (orderRows.length === 0) return null;
  return { order: mapOrder(orderRows[0]), items };
};

export const findItemsForOrder = async (
  orderId: string,
  exec: DbExecutor = db,
): Promise<SupplierOrderItem[]> => {
  const rows = await exec
    .select()
    .from(supplierSaleItems)
    .where(eq(supplierSaleItems.saleId, orderId));
  return rows.map(mapItem);
};

export const findLinkedInvoiceId = async (
  orderId: string,
  exec: DbExecutor = db,
): Promise<string | null> => {
  const rows = await exec
    .select({ id: supplierInvoices.id })
    .from(supplierInvoices)
    .where(eq(supplierInvoices.linkedSaleId, orderId))
    .limit(1);
  return rows[0]?.id ?? null;
};

export const findExistingByLinkedQuote = async (
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

export const findExistingForUpdate = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{
  id: string;
  linkedQuoteId: string | null;
  supplierId: string;
  supplierName: string;
  status: string;
} | null> => {
  const rows = await exec
    .select({
      id: supplierSales.id,
      linkedQuoteId: supplierSales.linkedQuoteId,
      supplierId: supplierSales.supplierId,
      supplierName: supplierSales.supplierName,
      status: supplierSales.status,
    })
    .from(supplierSales)
    .where(eq(supplierSales.id, id));
  return rows[0] ?? null;
};

export const findStatusAndSupplierName = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ status: string; supplierName: string } | null> => {
  const rows = await exec
    .select({ status: supplierSales.status, supplierName: supplierSales.supplierName })
    .from(supplierSales)
    .where(eq(supplierSales.id, id));
  return rows[0] ?? null;
};

export const findIdConflict = async (
  newId: string,
  currentId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const rows = await exec
    .select({ id: supplierSales.id })
    .from(supplierSales)
    .where(and(eq(supplierSales.id, newId), ne(supplierSales.id, currentId)));
  return rows.length > 0;
};

export type NewSupplierOrder = {
  id: string;
  linkedQuoteId: string;
  supplierId: string;
  supplierName: string;
  paymentTerms: string;
  discount: number;
  discountType: 'percentage' | 'currency';
  status: string;
  notes: string | null;
};

export const create = async (
  input: NewSupplierOrder,
  exec: DbExecutor = db,
): Promise<SupplierOrder> => {
  const [row] = await exec
    .insert(supplierSales)
    .values({
      id: input.id,
      linkedQuoteId: input.linkedQuoteId,
      supplierId: input.supplierId,
      supplierName: input.supplierName,
      paymentTerms: input.paymentTerms,
      discount: numericForDb(input.discount),
      discountType: input.discountType,
      status: input.status,
      notes: input.notes,
    })
    .returning();
  return mapOrder(row);
};

export type SupplierOrderUpdate = {
  id?: string;
  supplierId?: string;
  supplierName?: string;
  paymentTerms?: string;
  discount?: number;
  discountType?: 'percentage' | 'currency';
  status?: string;
  notes?: string | null;
};

export const update = async (
  id: string,
  patch: SupplierOrderUpdate,
  exec: DbExecutor = db,
): Promise<SupplierOrder | null> => {
  // Empty patch → fall back to SELECT so the row (and updated_at) is left untouched.
  // Matches pre-Drizzle behavior; without this guard, an empty PUT would bump updated_at
  // and create a misleading audit trail.
  if (!Object.values(patch).some((v) => v !== undefined)) {
    return findById(id, exec);
  }
  const [row] = await exec
    .update(supplierSales)
    .set({
      id: sql`COALESCE(${patch.id ?? null}, ${supplierSales.id})`,
      supplierId: sql`COALESCE(${patch.supplierId ?? null}, ${supplierSales.supplierId})`,
      supplierName: sql`COALESCE(${patch.supplierName ?? null}, ${supplierSales.supplierName})`,
      paymentTerms: sql`COALESCE(${patch.paymentTerms ?? null}, ${supplierSales.paymentTerms})`,
      discount: sql`COALESCE(${numericForDb(patch.discount) ?? null}::numeric, ${supplierSales.discount})`,
      discountType: sql`COALESCE(${patch.discountType ?? null}, ${supplierSales.discountType})`,
      status: sql`COALESCE(${patch.status ?? null}, ${supplierSales.status})`,
      notes: sql`COALESCE(${patch.notes ?? null}, ${supplierSales.notes})`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(supplierSales.id, id))
    .returning();
  return row ? mapOrder(row) : null;
};

export type SupplierOrderRestoreFields = Pick<
  SupplierOrder,
  'supplierId' | 'supplierName' | 'paymentTerms' | 'discount' | 'discountType' | 'status' | 'notes'
>;

export const restoreSnapshotOrder = async (
  id: string,
  snapshot: SupplierOrderRestoreFields,
  exec: DbExecutor = db,
): Promise<SupplierOrder | null> => {
  const [row] = await exec
    .update(supplierSales)
    .set({
      supplierId: snapshot.supplierId,
      supplierName: snapshot.supplierName,
      paymentTerms: snapshot.paymentTerms ?? 'immediate',
      discount: numericForDb(snapshot.discount),
      discountType: snapshot.discountType,
      status: snapshot.status,
      notes: snapshot.notes,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(supplierSales.id, id))
    .returning();
  return row ? mapOrder(row) : null;
};

export const deleteById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const result = await exec.delete(supplierSales).where(eq(supplierSales.id, id));
  return (result.rowCount ?? 0) > 0;
};

export type NewSupplierOrderItem = {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  note: string | null;
};

export const insertItems = async (
  orderId: string,
  items: NewSupplierOrderItem[],
  exec: DbExecutor = db,
): Promise<SupplierOrderItem[]> => {
  if (items.length === 0) return [];
  const rows = await exec
    .insert(supplierSaleItems)
    .values(
      items.map((item) => ({
        id: item.id,
        saleId: orderId,
        productId: item.productId,
        productName: item.productName,
        quantity: numericForDb(item.quantity),
        unitPrice: numericForDb(item.unitPrice),
        discount: numericForDb(item.discount),
        note: item.note,
      })),
    )
    .returning();
  return rows.map(mapItem);
};

export const replaceItems = async (
  orderId: string,
  items: NewSupplierOrderItem[],
  exec: DbExecutor = db,
): Promise<SupplierOrderItem[]> => {
  await exec.delete(supplierSaleItems).where(eq(supplierSaleItems.saleId, orderId));
  return insertItems(orderId, items, exec);
};
