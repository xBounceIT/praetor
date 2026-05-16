import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows, runAtomically } from '../db/drizzle.ts';
import { supplierInvoiceItems, supplierInvoices } from '../db/schema/supplierInvoices.ts';
import { requireDateOnly } from '../utils/date.ts';
import { numericForDb, parseDbNumber } from '../utils/parse.ts';

export type SupplierInvoice = {
  id: string;
  linkedSaleId: string | null;
  supplierId: string;
  supplierName: string;
  issueDate: string;
  dueDate: string;
  status: string;
  subtotal: number;
  total: number;
  amountPaid: number;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
};

export type SupplierInvoiceItem = {
  id: string;
  invoiceId: string;
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
};

const mapInvoice = (row: typeof supplierInvoices.$inferSelect): SupplierInvoice => ({
  id: row.id,
  linkedSaleId: row.linkedSaleId,
  supplierId: row.supplierId,
  supplierName: row.supplierName,
  issueDate: requireDateOnly(row.issueDate, 'supplierInvoice.issueDate'),
  dueDate: requireDateOnly(row.dueDate, 'supplierInvoice.dueDate'),
  status: row.status,
  subtotal: parseDbNumber(row.subtotal, 0),
  total: parseDbNumber(row.total, 0),
  amountPaid: parseDbNumber(row.amountPaid, 0),
  notes: row.notes,
  createdAt: row.createdAt?.getTime() ?? 0,
  updatedAt: row.updatedAt?.getTime() ?? 0,
});

const mapItem = (row: typeof supplierInvoiceItems.$inferSelect): SupplierInvoiceItem => ({
  id: row.id,
  invoiceId: row.invoiceId,
  productId: row.productId,
  description: row.description,
  quantity: parseDbNumber(row.quantity, 0),
  unitPrice: parseDbNumber(row.unitPrice, 0),
  discount: parseDbNumber(row.discount, 0),
});

// Memory-side cap on unfiltered listAll. There is no index on `created_at`, so Postgres
// still sorts the full table before applying LIMIT — this bounds heap usage, not DB work.
export const LIST_ALL_LIMIT = 1000;

export const listAll = async (exec: DbExecutor = db): Promise<SupplierInvoice[]> => {
  const rows = await exec
    .select()
    .from(supplierInvoices)
    .orderBy(desc(supplierInvoices.createdAt))
    .limit(LIST_ALL_LIMIT);
  return rows.map(mapInvoice);
};

export const listAllItems = async (exec: DbExecutor = db): Promise<SupplierInvoiceItem[]> => {
  const rows = await exec
    .select()
    .from(supplierInvoiceItems)
    .orderBy(asc(supplierInvoiceItems.createdAt), asc(supplierInvoiceItems.id));
  return rows.map(mapItem);
};

export const findById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<SupplierInvoice | null> => {
  const rows = await exec.select().from(supplierInvoices).where(eq(supplierInvoices.id, id));
  return rows[0] ? mapInvoice(rows[0]) : null;
};

export const findItemsForInvoice = async (
  invoiceId: string,
  exec: DbExecutor = db,
): Promise<SupplierInvoiceItem[]> => {
  const rows = await exec
    .select()
    .from(supplierInvoiceItems)
    .where(eq(supplierInvoiceItems.invoiceId, invoiceId))
    .orderBy(asc(supplierInvoiceItems.createdAt), asc(supplierInvoiceItems.id));
  return rows.map(mapItem);
};

export const findInvoiceForLinkedSale = async (
  saleId: string,
  exec: DbExecutor = db,
): Promise<string | null> => {
  const rows = await exec
    .select({ id: supplierInvoices.id })
    .from(supplierInvoices)
    .where(eq(supplierInvoices.linkedSaleId, saleId))
    .limit(1);
  return rows[0]?.id ?? null;
};

// Reads the minimal set of fields needed to gate updates / restores. Named `findExisting`
// (not `findExistingForUpdate`) because it does not acquire a row lock - callers run the read,
// validate, and then issue a separate UPDATE outside any locking scope. If you need true
// SELECT ... FOR UPDATE semantics, wrap in `withDbTransaction` and add `.for('update')`.
export const findExisting = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{
  id: string;
  status: string;
  issueDate: string;
  dueDate: string;
  total: number;
  amountPaid: number;
} | null> => {
  const rows = await exec
    .select({
      id: supplierInvoices.id,
      status: supplierInvoices.status,
      issueDate: supplierInvoices.issueDate,
      dueDate: supplierInvoices.dueDate,
      total: supplierInvoices.total,
      amountPaid: supplierInvoices.amountPaid,
    })
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, id));
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    status: rows[0].status,
    issueDate: requireDateOnly(rows[0].issueDate, 'supplierInvoice.issueDate'),
    dueDate: requireDateOnly(rows[0].dueDate, 'supplierInvoice.dueDate'),
    total: parseDbNumber(rows[0].total, 0),
    amountPaid: parseDbNumber(rows[0].amountPaid, 0),
  };
};

export const findStatusAndSupplierName = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ status: string; supplierName: string } | null> => {
  const rows = await exec
    .select({ status: supplierInvoices.status, supplierName: supplierInvoices.supplierName })
    .from(supplierInvoices)
    .where(eq(supplierInvoices.id, id));
  return rows[0] ?? null;
};

export const findIdConflict = async (
  newId: string,
  currentId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const rows = await exec
    .select({ id: supplierInvoices.id })
    .from(supplierInvoices)
    .where(and(eq(supplierInvoices.id, newId), ne(supplierInvoices.id, currentId)));
  return rows.length > 0;
};

// Matches `SINV-<year>-<sequence>` IDs and returns the largest sequence for the given year so
// the route layer can compute the next ID. PG's POSIX `~` regex isn't expressible in Drizzle's
// filter API, hence the raw SQL.
export const maxSequenceForYear = async (year: string, exec: DbExecutor = db): Promise<bigint> => {
  if (!/^\d{4}$/.test(year)) {
    throw new TypeError('supplier invoice year must be a 4-digit year');
  }

  const pattern = `^SINV-${year}-[0-9]+$`;
  const rows = await executeRows<{ maxSequence: string | number | bigint | null }>(
    exec,
    sql`SELECT COALESCE(MAX(CAST(split_part(id, '-', 3) AS BIGINT)), 0) AS "maxSequence"
        FROM ${supplierInvoices} WHERE id ~ ${pattern}`,
  );
  return BigInt(rows[0]?.maxSequence ?? 0);
};

export type NewSupplierInvoice = {
  id: string;
  linkedSaleId: string | null;
  supplierId: string;
  supplierName: string;
  issueDate: string;
  dueDate: string;
  status: string;
  subtotal: number;
  total: number;
  amountPaid: number;
  notes: string | null;
};

export const create = async (
  input: NewSupplierInvoice,
  exec: DbExecutor = db,
): Promise<SupplierInvoice> => {
  const [row] = await exec
    .insert(supplierInvoices)
    .values({
      id: input.id,
      linkedSaleId: input.linkedSaleId,
      supplierId: input.supplierId,
      supplierName: input.supplierName,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      status: input.status,
      subtotal: numericForDb(input.subtotal),
      total: numericForDb(input.total),
      amountPaid: numericForDb(input.amountPaid),
      notes: input.notes,
    })
    .returning();
  return mapInvoice(row);
};

export type SupplierInvoiceUpdate = {
  id?: string;
  supplierId?: string;
  supplierName?: string;
  issueDate?: string;
  dueDate?: string;
  status?: string;
  subtotal?: number;
  total?: number;
  amountPaid?: number;
  notes?: string | null;
};

export const update = async (
  id: string,
  patch: SupplierInvoiceUpdate,
  exec: DbExecutor = db,
): Promise<SupplierInvoice | null> => {
  // Empty patch → fall back to SELECT so the row (and updated_at) is left untouched.
  // Matches pre-Drizzle behavior; without this guard, an empty PUT would bump updated_at
  // and create a misleading audit trail.
  if (!Object.values(patch).some((v) => v !== undefined)) {
    return findById(id, exec);
  }
  const [row] = await exec
    .update(supplierInvoices)
    .set({
      id: sql`COALESCE(${patch.id ?? null}, ${supplierInvoices.id})`,
      supplierId: sql`COALESCE(${patch.supplierId ?? null}, ${supplierInvoices.supplierId})`,
      supplierName: sql`COALESCE(${patch.supplierName ?? null}, ${supplierInvoices.supplierName})`,
      issueDate: sql`COALESCE(${patch.issueDate ?? null}::date, ${supplierInvoices.issueDate})`,
      dueDate: sql`COALESCE(${patch.dueDate ?? null}::date, ${supplierInvoices.dueDate})`,
      status: sql`COALESCE(${patch.status ?? null}, ${supplierInvoices.status})`,
      subtotal: sql`COALESCE(${numericForDb(patch.subtotal) ?? null}::numeric, ${supplierInvoices.subtotal})`,
      total: sql`COALESCE(${numericForDb(patch.total) ?? null}::numeric, ${supplierInvoices.total})`,
      amountPaid: sql`COALESCE(${numericForDb(patch.amountPaid) ?? null}::numeric, ${supplierInvoices.amountPaid})`,
      notes: sql`COALESCE(${patch.notes ?? null}, ${supplierInvoices.notes})`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(supplierInvoices.id, id))
    .returning();
  return row ? mapInvoice(row) : null;
};

export const deleteById = async (id: string, exec: DbExecutor = db): Promise<boolean> => {
  const result = await exec.delete(supplierInvoices).where(eq(supplierInvoices.id, id));
  return (result.rowCount ?? 0) > 0;
};

export type NewSupplierInvoiceItem = {
  id: string;
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
};

export const insertItems = async (
  invoiceId: string,
  items: NewSupplierInvoiceItem[],
  exec: DbExecutor = db,
): Promise<SupplierInvoiceItem[]> => {
  if (items.length === 0) return [];
  const rows = await exec
    .insert(supplierInvoiceItems)
    .values(
      items.map((item) => ({
        id: item.id,
        invoiceId,
        productId: item.productId,
        description: item.description,
        quantity: numericForDb(item.quantity),
        unitPrice: numericForDb(item.unitPrice),
        discount: numericForDb(item.discount),
      })),
    )
    .returning();
  return rows.map(mapItem);
};

export const replaceItems = async (
  invoiceId: string,
  items: NewSupplierInvoiceItem[],
  exec: DbExecutor = db,
): Promise<SupplierInvoiceItem[]> =>
  runAtomically(exec, async (tx) => {
    await tx.delete(supplierInvoiceItems).where(eq(supplierInvoiceItems.invoiceId, invoiceId));
    return insertItems(invoiceId, items, tx);
  });
