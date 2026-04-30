import pool, { buildBulkInsertPlaceholders, type QueryExecutor } from '../db/index.ts';
import { requireDateOnly } from '../utils/date.ts';
import { parseDbNumber } from '../utils/parse.ts';

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

type InvoiceRow = {
  id: string;
  linkedSaleId: string | null;
  clientId: string;
  clientName: string;
  issueDate: string | Date | null;
  dueDate: string | Date | null;
  status: string;
  subtotal: string | number;
  total: string | number;
  amountPaid: string | number;
  notes: string | null;
  createdAt: string | number;
  updatedAt: string | number;
};

type InvoiceItemRow = {
  id: string;
  invoiceId: string;
  productId: string | null;
  description: string;
  unitOfMeasure: string | null;
  quantity: string | number;
  unitPrice: string | number;
  discount: string | number;
};

const INVOICE_COLUMNS = `
  id,
  linked_sale_id as "linkedSaleId",
  client_id as "clientId",
  client_name as "clientName",
  issue_date as "issueDate",
  due_date as "dueDate",
  status,
  subtotal,
  total,
  amount_paid as "amountPaid",
  notes,
  EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
  EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"
`;

const ITEM_COLUMNS = `
  id,
  invoice_id as "invoiceId",
  product_id as "productId",
  description,
  unit_of_measure as "unitOfMeasure",
  quantity,
  unit_price as "unitPrice",
  discount
`;

const mapInvoice = (row: InvoiceRow): Invoice => ({
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
  createdAt: parseDbNumber(row.createdAt, 0),
  updatedAt: parseDbNumber(row.updatedAt, 0),
});

const mapItem = (row: InvoiceItemRow): InvoiceItem => ({
  id: row.id,
  invoiceId: row.invoiceId,
  productId: row.productId,
  description: row.description,
  unitOfMeasure: row.unitOfMeasure === 'hours' ? 'hours' : 'unit',
  quantity: parseDbNumber(row.quantity, 0),
  unitPrice: parseDbNumber(row.unitPrice, 0),
  discount: parseDbNumber(row.discount, 0),
});

export const generateNextId = async (year: string, exec: QueryExecutor = pool): Promise<string> => {
  const { rows } = await exec.query<{ maxSequence: string | number | null }>(
    `SELECT COALESCE(MAX(CAST(split_part(id, '-', 3) AS INTEGER)), 0) as "maxSequence"
       FROM invoices
       WHERE id ~ $1`,
    [`^INV-${year}-[0-9]+$`],
  );
  const nextSequence = Number(rows[0]?.maxSequence ?? 0) + 1;
  return `INV-${year}-${String(nextSequence).padStart(4, '0')}`;
};

export const listAll = async (exec: QueryExecutor = pool): Promise<Invoice[]> => {
  const { rows } = await exec.query<InvoiceRow>(
    `SELECT ${INVOICE_COLUMNS} FROM invoices ORDER BY created_at DESC`,
  );
  return rows.map(mapInvoice);
};

export const listAllItems = async (exec: QueryExecutor = pool): Promise<InvoiceItem[]> => {
  const { rows } = await exec.query<InvoiceItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM invoice_items ORDER BY created_at ASC`,
  );
  return rows.map(mapItem);
};

export const listAllWithItems = async (exec: QueryExecutor = pool): Promise<InvoiceWithItems[]> => {
  const [invoices, items] = await Promise.all([listAll(exec), listAllItems(exec)]);
  const itemsByInvoice = new Map<string, InvoiceItem[]>();
  for (const item of items) {
    const list = itemsByInvoice.get(item.invoiceId);
    if (list) list.push(item);
    else itemsByInvoice.set(item.invoiceId, [item]);
  }
  return invoices.map((invoice) => ({
    ...invoice,
    items: itemsByInvoice.get(invoice.id) ?? [],
  }));
};

export const findDates = async (
  invoiceId: string,
  exec: QueryExecutor = pool,
): Promise<{ issueDate: string; dueDate: string } | null> => {
  const { rows } = await exec.query<{
    issueDate: string | Date | null;
    dueDate: string | Date | null;
  }>(`SELECT issue_date as "issueDate", due_date as "dueDate" FROM invoices WHERE id = $1`, [
    invoiceId,
  ]);
  if (!rows[0]) return null;
  return {
    issueDate: requireDateOnly(rows[0].issueDate, 'invoice.issueDate'),
    dueDate: requireDateOnly(rows[0].dueDate, 'invoice.dueDate'),
  };
};

export const findIdConflict = async (
  newId: string,
  currentId: string,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM invoices WHERE id = $1 AND id <> $2`,
    [newId, currentId],
  );
  return rows.length > 0;
};

export const findItemsForInvoice = async (
  invoiceId: string,
  exec: QueryExecutor = pool,
): Promise<InvoiceItem[]> => {
  const { rows } = await exec.query<InvoiceItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM invoice_items WHERE invoice_id = $1`,
    [invoiceId],
  );
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

export const create = async (input: NewInvoice, exec: QueryExecutor = pool): Promise<Invoice> => {
  const { rows } = await exec.query<InvoiceRow>(
    `INSERT INTO invoices (
       id, linked_sale_id, client_id, client_name, issue_date, due_date,
       status, subtotal, total, amount_paid, notes
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${INVOICE_COLUMNS}`,
    [
      input.id,
      input.linkedSaleId,
      input.clientId,
      input.clientName,
      input.issueDate,
      input.dueDate,
      input.status,
      input.subtotal,
      input.total,
      input.amountPaid,
      input.notes,
    ],
  );
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
  exec: QueryExecutor = pool,
): Promise<Invoice | null> => {
  const { rows } = await exec.query<InvoiceRow>(
    `UPDATE invoices SET
        id = COALESCE($1, id),
        client_id = COALESCE($2, client_id),
        client_name = COALESCE($3, client_name),
        issue_date = COALESCE($4, issue_date),
        due_date = COALESCE($5, due_date),
        status = COALESCE($6, status),
        subtotal = COALESCE($7, subtotal),
        total = COALESCE($8, total),
        amount_paid = COALESCE($9, amount_paid),
        notes = COALESCE($10, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $11
      RETURNING ${INVOICE_COLUMNS}`,
    [
      patch.id ?? null,
      patch.clientId ?? null,
      patch.clientName ?? null,
      patch.issueDate ?? null,
      patch.dueDate ?? null,
      patch.status ?? null,
      patch.subtotal ?? null,
      patch.total ?? null,
      patch.amountPaid ?? null,
      patch.notes ?? null,
      id,
    ],
  );
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
  exec: QueryExecutor = pool,
): Promise<InvoiceItem[]> => {
  if (items.length === 0) return [];
  const placeholders = buildBulkInsertPlaceholders(items.length, 8);
  const params = items.flatMap((item) => [
    item.id,
    invoiceId,
    item.productId,
    item.description,
    item.unitOfMeasure,
    item.quantity,
    item.unitPrice,
    item.discount,
  ]);
  const { rows } = await exec.query<InvoiceItemRow>(
    `INSERT INTO invoice_items (
       id, invoice_id, product_id, description, unit_of_measure, quantity, unit_price, discount
     ) VALUES ${placeholders}
     RETURNING ${ITEM_COLUMNS}`,
    params,
  );
  return rows.map(mapItem);
};

export const replaceItems = async (
  invoiceId: string,
  items: NewInvoiceItem[],
  exec: QueryExecutor = pool,
): Promise<InvoiceItem[]> => {
  await exec.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [invoiceId]);
  return insertItems(invoiceId, items, exec);
};

export const deleteById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<{ id: string; clientName: string } | null> => {
  const { rows } = await exec.query<{ id: string; clientName: string }>(
    `DELETE FROM invoices WHERE id = $1 RETURNING id, client_name as "clientName"`,
    [id],
  );
  return rows[0] ?? null;
};
