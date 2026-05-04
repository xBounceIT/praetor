import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { type DbExecutor, db, executeRows } from '../db/drizzle.ts';
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
  const rows = await exec.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
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
  total?: number;
  amountPaid?: number;
  notes?: string | null;
};

export const update = async (
  id: string,
  patch: InvoiceUpdate,
  exec: DbExecutor = db,
): Promise<Invoice | null> => {
  const rows = await exec
    .update(invoices)
    .set({
      id: sql`COALESCE(${patch.id ?? null}, ${invoices.id})`,
      clientId: sql`COALESCE(${patch.clientId ?? null}, ${invoices.clientId})`,
      clientName: sql`COALESCE(${patch.clientName ?? null}, ${invoices.clientName})`,
      issueDate: sql`COALESCE(${patch.issueDate ?? null}::date, ${invoices.issueDate})`,
      dueDate: sql`COALESCE(${patch.dueDate ?? null}::date, ${invoices.dueDate})`,
      status: sql`COALESCE(${patch.status ?? null}, ${invoices.status})`,
      subtotal: sql`COALESCE(${numericForDb(patch.subtotal) ?? null}::numeric, ${invoices.subtotal})`,
      total: sql`COALESCE(${numericForDb(patch.total) ?? null}::numeric, ${invoices.total})`,
      amountPaid: sql`COALESCE(${numericForDb(patch.amountPaid) ?? null}::numeric, ${invoices.amountPaid})`,
      notes: sql`COALESCE(${patch.notes ?? null}, ${invoices.notes})`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(invoices.id, id))
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
      })),
    )
    .returning();
  return rows.map(mapItem);
};

export const replaceItems = async (
  invoiceId: string,
  items: NewInvoiceItem[],
  exec: DbExecutor = db,
): Promise<InvoiceItem[]> => {
  await exec.delete(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
  return insertItems(invoiceId, items, exec);
};

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
