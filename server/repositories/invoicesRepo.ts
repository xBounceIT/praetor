import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows, runAtomically } from '../db/drizzle.ts';
import { invoiceItems, invoices } from '../db/schema/invoices.ts';
import { requireDateOnly } from '../utils/date.ts';
import { numericForDb, parseDbNumber } from '../utils/parse.ts';

export type Invoice = {
  id: string;
  linkedSaleId: string | null;
  clientId: string;
  clientName: string;
  issueDate: string;
  dueDate: string;
  status: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
};

export type InvoiceItem = {
  id: string;
  invoiceId: string;
  productId: string | null;
  description: string;
  unitOfMeasure: 'unit' | 'hours';
  quantity: number;
  unitPrice: number;
  discount: number;
  // Per-item VAT (IVA) rate in percent. 0 for exempt/legacy rows.
  taxRate: number;
};

export type InvoiceWithItems = Invoice & { items: InvoiceItem[] };

const mapInvoice = (row: typeof invoices.$inferSelect): Invoice => ({
  id: row.id,
  linkedSaleId: row.linkedSaleId,
  clientId: row.clientId,
  clientName: row.clientName,
  issueDate: requireDateOnly(row.issueDate, 'invoice.issueDate'),
  dueDate: requireDateOnly(row.dueDate, 'invoice.dueDate'),
  status: row.status,
  subtotal: parseDbNumber(row.subtotal, 0),
  taxTotal: parseDbNumber(row.taxTotal, 0),
  total: parseDbNumber(row.total, 0),
  amountPaid: parseDbNumber(row.amountPaid, 0),
  notes: row.notes,
  createdAt: row.createdAt?.getTime() ?? 0,
  updatedAt: row.updatedAt?.getTime() ?? 0,
});

const mapItem = (row: typeof invoiceItems.$inferSelect): InvoiceItem => ({
  id: row.id,
  invoiceId: row.invoiceId,
  productId: row.productId,
  description: row.description,
  unitOfMeasure: row.unitOfMeasure === 'hours' ? 'hours' : 'unit',
  quantity: parseDbNumber(row.quantity, 0),
  unitPrice: parseDbNumber(row.unitPrice, 0),
  discount: parseDbNumber(row.discount, 0),
  taxRate: parseDbNumber(row.taxRate, 0),
});

export const generateNextId = async (year: string, exec: DbExecutor = db): Promise<string> => {
  // PostgreSQL regex `~` operator + server-side split_part avoids round-tripping every
  // matching id back to the app just to extract the sequence number.
  const rows = await executeRows<{ maxSequence: string | number | null }>(
    exec,
    sql`SELECT COALESCE(MAX(CAST(split_part(id, '-', 3) AS INTEGER)), 0) AS "maxSequence"
          FROM invoices
         WHERE id ~ ${`^INV-${year}-[0-9]+$`}`,
  );
  const nextSequence = Number(rows[0]?.maxSequence ?? 0) + 1;
  return `INV-${year}-${String(nextSequence).padStart(4, '0')}`;
};

export const listAll = async (exec: DbExecutor = db): Promise<Invoice[]> => {
  const rows = await exec.select().from(invoices).orderBy(desc(invoices.createdAt));
  return rows.map(mapInvoice);
};

export const listAllItems = async (exec: DbExecutor = db): Promise<InvoiceItem[]> => {
  const rows = await exec.select().from(invoiceItems).orderBy(invoiceItems.createdAt);
  return rows.map(mapItem);
};

export const listAllWithItems = async (exec: DbExecutor = db): Promise<InvoiceWithItems[]> => {
  const [invoiceList, items] = await Promise.all([listAll(exec), listAllItems(exec)]);
  const itemsByInvoice = new Map<string, InvoiceItem[]>();
  for (const item of items) {
    const list = itemsByInvoice.get(item.invoiceId);
    if (list) list.push(item);
    else itemsByInvoice.set(item.invoiceId, [item]);
  }
  return invoiceList.map((invoice) => ({
    ...invoice,
    items: itemsByInvoice.get(invoice.id) ?? [],
  }));
};

export const findDates = async (
  invoiceId: string,
  exec: DbExecutor = db,
): Promise<{ issueDate: string; dueDate: string } | null> => {
  const rows = await exec
    .select({ issueDate: invoices.issueDate, dueDate: invoices.dueDate })
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  if (!rows[0]) return null;
  return {
    issueDate: requireDateOnly(rows[0].issueDate, 'invoice.issueDate'),
    dueDate: requireDateOnly(rows[0].dueDate, 'invoice.dueDate'),
  };
};

export const findTotal = async (
  invoiceId: string,
  exec: DbExecutor = db,
): Promise<number | null> => {
  const rows = await exec
    .select({ total: invoices.total })
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  if (!rows[0]) return null;
  return parseDbNumber(rows[0].total, 0);
};

export const findAmountPaid = async (
  invoiceId: string,
  exec: DbExecutor = db,
): Promise<number | null> => {
  const rows = await exec
    .select({ amountPaid: invoices.amountPaid })
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  if (!rows[0]) return null;
  return parseDbNumber(rows[0].amountPaid, 0);
};

export const findStatus = async (
  invoiceId: string,
  exec: DbExecutor = db,
): Promise<string | null> => {
  const rows = await exec
    .select({ status: invoices.status })
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  return rows[0]?.status ?? null;
};

export const findStatusAndClientName = async (
  invoiceId: string,
  exec: DbExecutor = db,
): Promise<{ status: string; clientName: string } | null> => {
  const rows = await exec
    .select({ status: invoices.status, clientName: invoices.clientName })
    .from(invoices)
    .where(eq(invoices.id, invoiceId));
  return rows[0] ?? null;
};

export const findIdConflict = async (
  newId: string,
  currentId: string,
  exec: DbExecutor = db,
): Promise<boolean> => {
  const rows = await exec
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.id, newId), ne(invoices.id, currentId)));
  return rows.length > 0;
};

export const findItemsForInvoice = async (
  invoiceId: string,
  exec: DbExecutor = db,
): Promise<InvoiceItem[]> => {
  const rows = await exec
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoiceId))
    .orderBy(asc(invoiceItems.createdAt), asc(invoiceItems.id));
  return rows.map(mapItem);
};

export type NewInvoice = {
  id: string;
  linkedSaleId: string | null;
  clientId: string;
  clientName: string;
  issueDate: string;
  dueDate: string;
  status: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  notes: string | null;
};

export const create = async (input: NewInvoice, exec: DbExecutor = db): Promise<Invoice> => {
  const rows = await exec
    .insert(invoices)
    .values({
      id: input.id,
      linkedSaleId: input.linkedSaleId,
      clientId: input.clientId,
      clientName: input.clientName,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      status: input.status,
      subtotal: numericForDb(input.subtotal),
      taxTotal: numericForDb(input.taxTotal),
      total: numericForDb(input.total),
      amountPaid: numericForDb(input.amountPaid),
      notes: input.notes,
    })
    .returning();
  return mapInvoice(rows[0]);
};

export type InvoiceUpdate = {
  id?: string;
  clientId?: string;
  clientName?: string;
  issueDate?: string;
  dueDate?: string;
  status?: string;
  subtotal?: number;
  taxTotal?: number;
  total?: number;
  amountPaid?: number;
  notes?: string | null;
};

const invoiceUpdateValues = (patch: InvoiceUpdate) => {
  const set: Record<string, unknown> = {};
  if (patch.id !== undefined) set.id = patch.id;
  if (patch.clientId !== undefined) set.clientId = patch.clientId;
  if (patch.clientName !== undefined) set.clientName = patch.clientName;
  if (patch.issueDate !== undefined) set.issueDate = patch.issueDate;
  if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.subtotal !== undefined) set.subtotal = numericForDb(patch.subtotal);
  if (patch.taxTotal !== undefined) set.taxTotal = numericForDb(patch.taxTotal);
  if (patch.total !== undefined) set.total = numericForDb(patch.total);
  if (patch.amountPaid !== undefined) set.amountPaid = numericForDb(patch.amountPaid);
  if (patch.notes !== undefined) set.notes = patch.notes;
  set.updatedAt = sql`CURRENT_TIMESTAMP`;
  return set;
};

export const update = async (
  id: string,
  patch: InvoiceUpdate,
  exec: DbExecutor = db,
): Promise<Invoice | null> => {
  const rows = await exec
    .update(invoices)
    .set(invoiceUpdateValues(patch))
    .where(eq(invoices.id, id))
    .returning();
  return rows[0] ? mapInvoice(rows[0]) : null;
};

export const updateDraft = async (
  id: string,
  patch: InvoiceUpdate,
  exec: DbExecutor = db,
): Promise<Invoice | null> => {
  const rows = await exec
    .update(invoices)
    .set(invoiceUpdateValues(patch))
    .where(and(eq(invoices.id, id), eq(invoices.status, 'draft')))
    .returning();
  return rows[0] ? mapInvoice(rows[0]) : null;
};

export type NewInvoiceItem = {
  id: string;
  productId: string | null;
  description: string;
  unitOfMeasure: 'unit' | 'hours';
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
};

export const insertItems = async (
  invoiceId: string,
  items: NewInvoiceItem[],
  exec: DbExecutor = db,
): Promise<InvoiceItem[]> => {
  if (items.length === 0) return [];
  const rows = await exec
    .insert(invoiceItems)
    .values(
      items.map((item) => ({
        id: item.id,
        invoiceId,
        productId: item.productId,
        description: item.description,
        unitOfMeasure: item.unitOfMeasure,
        quantity: numericForDb(item.quantity),
        unitPrice: numericForDb(item.unitPrice),
        discount: numericForDb(item.discount),
        taxRate: numericForDb(item.taxRate),
      })),
    )
    .returning();
  return rows.map(mapItem);
};

export const replaceItems = async (
  invoiceId: string,
  items: NewInvoiceItem[],
  exec: DbExecutor = db,
): Promise<InvoiceItem[]> =>
  runAtomically(exec, async (tx) => {
    await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
    return insertItems(invoiceId, items, tx);
  });

export const deleteById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ id: string; clientName: string } | null> => {
  const rows = await exec
    .delete(invoices)
    .where(eq(invoices.id, id))
    .returning({ id: invoices.id, clientName: invoices.clientName });
  return rows[0] ?? null;
};

export const deleteDraftById = async (
  id: string,
  exec: DbExecutor = db,
): Promise<{ id: string; clientName: string } | null> => {
  const rows = await exec
    .delete(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.status, 'draft')))
    .returning({ id: invoices.id, clientName: invoices.clientName });
  return rows[0] ?? null;
};
