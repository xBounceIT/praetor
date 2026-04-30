import pool, { buildBulkInsertPlaceholders, type QueryExecutor } from '../db/index.ts';
import { requireDateOnly } from '../utils/date.ts';
import { parseDbNumber } from '../utils/parse.ts';

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

type SupplierInvoiceRow = {
  id: string;
  linkedSaleId: string | null;
  supplierId: string;
  supplierName: string;
  issueDate: string | Date;
  dueDate: string | Date;
  status: string;
  subtotal: string | number | null;
  total: string | number | null;
  amountPaid: string | number | null;
  notes: string | null;
  createdAt: string | number;
  updatedAt: string | number;
};

type SupplierInvoiceItemRow = {
  id: string;
  invoiceId: string;
  productId: string | null;
  description: string;
  quantity: string | number;
  unitPrice: string | number;
  discount: string | number | null;
};

const INVOICE_COLUMNS = `
  id,
  linked_sale_id as "linkedSaleId",
  supplier_id as "supplierId",
  supplier_name as "supplierName",
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
  quantity,
  unit_price as "unitPrice",
  discount
`;

const mapInvoice = (row: SupplierInvoiceRow): SupplierInvoice => ({
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
  createdAt: parseDbNumber(row.createdAt, 0),
  updatedAt: parseDbNumber(row.updatedAt, 0),
});

const mapItem = (row: SupplierInvoiceItemRow): SupplierInvoiceItem => ({
  id: row.id,
  invoiceId: row.invoiceId,
  productId: row.productId,
  description: row.description,
  quantity: parseDbNumber(row.quantity, 0),
  unitPrice: parseDbNumber(row.unitPrice, 0),
  discount: parseDbNumber(row.discount, 0),
});

export const listAll = async (exec: QueryExecutor = pool): Promise<SupplierInvoice[]> => {
  const { rows } = await exec.query<SupplierInvoiceRow>(
    `SELECT ${INVOICE_COLUMNS} FROM supplier_invoices ORDER BY created_at DESC`,
  );
  return rows.map(mapInvoice);
};

export const listAllItems = async (exec: QueryExecutor = pool): Promise<SupplierInvoiceItem[]> => {
  const { rows } = await exec.query<SupplierInvoiceItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM supplier_invoice_items ORDER BY created_at ASC`,
  );
  return rows.map(mapItem);
};

export const findById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<SupplierInvoice | null> => {
  const { rows } = await exec.query<SupplierInvoiceRow>(
    `SELECT ${INVOICE_COLUMNS} FROM supplier_invoices WHERE id = $1`,
    [id],
  );
  return rows[0] ? mapInvoice(rows[0]) : null;
};

export const findItemsForInvoice = async (
  invoiceId: string,
  exec: QueryExecutor = pool,
): Promise<SupplierInvoiceItem[]> => {
  const { rows } = await exec.query<SupplierInvoiceItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM supplier_invoice_items WHERE invoice_id = $1`,
    [invoiceId],
  );
  return rows.map(mapItem);
};

export const findInvoiceForLinkedSale = async (
  saleId: string,
  exec: QueryExecutor = pool,
): Promise<string | null> => {
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM supplier_invoices WHERE linked_sale_id = $1 LIMIT 1`,
    [saleId],
  );
  return rows[0]?.id ?? null;
};

export const findExistingForUpdate = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<{
  id: string;
  status: string;
  issueDate: string;
  dueDate: string;
} | null> => {
  const { rows } = await exec.query<{
    id: string;
    status: string;
    issueDate: string | Date;
    dueDate: string | Date;
  }>(
    `SELECT id, status, issue_date as "issueDate", due_date as "dueDate"
       FROM supplier_invoices WHERE id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    status: rows[0].status,
    issueDate: requireDateOnly(rows[0].issueDate, 'supplierInvoice.issueDate'),
    dueDate: requireDateOnly(rows[0].dueDate, 'supplierInvoice.dueDate'),
  };
};

export const findStatusAndSupplierName = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<{ status: string; supplierName: string } | null> => {
  const { rows } = await exec.query<{ status: string; supplierName: string }>(
    `SELECT status, supplier_name as "supplierName" FROM supplier_invoices WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
};

export const findIdConflict = async (
  newId: string,
  currentId: string,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM supplier_invoices WHERE id = $1 AND id <> $2`,
    [newId, currentId],
  );
  return rows.length > 0;
};

export const maxSequenceForYear = async (
  year: string,
  exec: QueryExecutor = pool,
): Promise<number> => {
  const { rows } = await exec.query<{ maxSequence: string | number | null }>(
    `SELECT COALESCE(MAX(CAST(split_part(id, '-', 3) AS INTEGER)), 0) as "maxSequence"
       FROM supplier_invoices
      WHERE id ~ $1`,
    [`^SINV-${year}-[0-9]+$`],
  );
  return Number(rows[0]?.maxSequence ?? 0);
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
  exec: QueryExecutor = pool,
): Promise<SupplierInvoice> => {
  const { rows } = await exec.query<SupplierInvoiceRow>(
    `INSERT INTO supplier_invoices
       (id, linked_sale_id, supplier_id, supplier_name, issue_date, due_date, status, subtotal, total, amount_paid, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${INVOICE_COLUMNS}`,
    [
      input.id,
      input.linkedSaleId,
      input.supplierId,
      input.supplierName,
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
  exec: QueryExecutor = pool,
): Promise<SupplierInvoice | null> => {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  const fields: Array<[string, unknown]> = [
    ['id', patch.id],
    ['supplier_id', patch.supplierId],
    ['supplier_name', patch.supplierName],
    ['issue_date', patch.issueDate],
    ['due_date', patch.dueDate],
    ['status', patch.status],
    ['subtotal', patch.subtotal],
    ['total', patch.total],
    ['amount_paid', patch.amountPaid],
    ['notes', patch.notes],
  ];
  for (const [col, value] of fields) {
    if (value !== undefined) {
      sets.push(`${col} = $${idx++}`);
      params.push(value);
    }
  }

  if (sets.length === 0) {
    const { rows } = await exec.query<SupplierInvoiceRow>(
      `SELECT ${INVOICE_COLUMNS} FROM supplier_invoices WHERE id = $1`,
      [id],
    );
    return rows[0] ? mapInvoice(rows[0]) : null;
  }

  sets.push(`updated_at = CURRENT_TIMESTAMP`);
  params.push(id);
  const { rows } = await exec.query<SupplierInvoiceRow>(
    `UPDATE supplier_invoices SET ${sets.join(', ')} WHERE id = $${idx} RETURNING ${INVOICE_COLUMNS}`,
    params,
  );
  return rows[0] ? mapInvoice(rows[0]) : null;
};

export const deleteById = async (id: string, exec: QueryExecutor = pool): Promise<boolean> => {
  const { rowCount } = await exec.query(`DELETE FROM supplier_invoices WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
};

export type NewSupplierInvoiceItem = {
  id: string;
  productId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
};

export const replaceItems = async (
  invoiceId: string,
  items: NewSupplierInvoiceItem[],
  exec: QueryExecutor,
): Promise<SupplierInvoiceItem[]> => {
  await exec.query(`DELETE FROM supplier_invoice_items WHERE invoice_id = $1`, [invoiceId]);
  if (items.length === 0) return [];
  const placeholders = buildBulkInsertPlaceholders(items.length, 7);
  const params = items.flatMap((item) => [
    item.id,
    invoiceId,
    item.productId,
    item.description,
    item.quantity,
    item.unitPrice,
    item.discount,
  ]);
  const { rows } = await exec.query<SupplierInvoiceItemRow>(
    `INSERT INTO supplier_invoice_items
       (id, invoice_id, product_id, description, quantity, unit_price, discount)
     VALUES ${placeholders}
     RETURNING ${ITEM_COLUMNS}`,
    params,
  );
  return rows.map(mapItem);
};
