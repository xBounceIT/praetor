import pool, { buildBulkInsertPlaceholders, type QueryExecutor } from '../db/index.ts';
import { parseDbNumber } from '../utils/parse.ts';

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

type SupplierOrderRow = {
  id: string;
  linkedQuoteId: string | null;
  supplierId: string;
  supplierName: string;
  paymentTerms: string | null;
  discount: string | number;
  discountType: string;
  status: string;
  notes: string | null;
  createdAt: string | number;
  updatedAt: string | number;
};

type SupplierOrderItemRow = {
  id: string;
  orderId: string;
  productId: string | null;
  productName: string;
  quantity: string | number;
  unitPrice: string | number;
  discount: string | number;
  note: string | null;
};

const ORDER_COLUMNS = `
  id,
  linked_quote_id as "linkedQuoteId",
  supplier_id as "supplierId",
  supplier_name as "supplierName",
  payment_terms as "paymentTerms",
  discount,
  discount_type as "discountType",
  status,
  notes,
  EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
  EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"
`;

const ITEM_COLUMNS = `
  id,
  sale_id as "orderId",
  product_id as "productId",
  product_name as "productName",
  quantity,
  unit_price as "unitPrice",
  discount,
  note
`;

const mapOrder = (row: SupplierOrderRow): SupplierOrder => ({
  id: row.id,
  linkedQuoteId: row.linkedQuoteId,
  supplierId: row.supplierId,
  supplierName: row.supplierName,
  paymentTerms: row.paymentTerms,
  discount: parseDbNumber(row.discount, 0),
  discountType: row.discountType === 'currency' ? 'currency' : 'percentage',
  status: row.status,
  notes: row.notes,
  createdAt: parseDbNumber(row.createdAt, 0),
  updatedAt: parseDbNumber(row.updatedAt, 0),
});

const mapItem = (row: SupplierOrderItemRow): SupplierOrderItem => ({
  id: row.id,
  orderId: row.orderId,
  productId: row.productId,
  productName: row.productName,
  quantity: parseDbNumber(row.quantity, 0),
  unitPrice: parseDbNumber(row.unitPrice, 0),
  discount: parseDbNumber(row.discount, 0),
  note: row.note,
});

export const listAll = async (exec: QueryExecutor = pool): Promise<SupplierOrder[]> => {
  const { rows } = await exec.query<SupplierOrderRow>(
    `SELECT ${ORDER_COLUMNS} FROM supplier_sales ORDER BY created_at DESC`,
  );
  return rows.map(mapOrder);
};

export const listAllItems = async (exec: QueryExecutor = pool): Promise<SupplierOrderItem[]> => {
  const { rows } = await exec.query<SupplierOrderItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM supplier_sale_items ORDER BY created_at ASC`,
  );
  return rows.map(mapItem);
};

export const findById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<SupplierOrder | null> => {
  const { rows } = await exec.query<SupplierOrderRow>(
    `SELECT ${ORDER_COLUMNS} FROM supplier_sales WHERE id = $1`,
    [id],
  );
  return rows[0] ? mapOrder(rows[0]) : null;
};

export const findItemsForOrder = async (
  orderId: string,
  exec: QueryExecutor = pool,
): Promise<SupplierOrderItem[]> => {
  const { rows } = await exec.query<SupplierOrderItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM supplier_sale_items WHERE sale_id = $1`,
    [orderId],
  );
  return rows.map(mapItem);
};

export const findLinkedInvoiceId = async (
  orderId: string,
  exec: QueryExecutor = pool,
): Promise<string | null> => {
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM supplier_invoices WHERE linked_sale_id = $1 LIMIT 1`,
    [orderId],
  );
  return rows[0]?.id ?? null;
};

export const findExistingByLinkedQuote = async (
  quoteId: string,
  exec: QueryExecutor = pool,
): Promise<string | null> => {
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM supplier_sales WHERE linked_quote_id = $1 LIMIT 1`,
    [quoteId],
  );
  return rows[0]?.id ?? null;
};

export const findExistingForUpdate = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<{
  id: string;
  linkedQuoteId: string | null;
  supplierId: string;
  supplierName: string;
  status: string;
} | null> => {
  const { rows } = await exec.query<{
    id: string;
    linkedQuoteId: string | null;
    supplierId: string;
    supplierName: string;
    status: string;
  }>(
    `SELECT id,
            linked_quote_id as "linkedQuoteId",
            supplier_id as "supplierId",
            supplier_name as "supplierName",
            status
       FROM supplier_sales WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
};

export const findStatusAndSupplierName = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<{ status: string; supplierName: string } | null> => {
  const { rows } = await exec.query<{ status: string; supplierName: string }>(
    `SELECT status, supplier_name as "supplierName" FROM supplier_sales WHERE id = $1`,
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
    `SELECT id FROM supplier_sales WHERE id = $1 AND id <> $2`,
    [newId, currentId],
  );
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
  exec: QueryExecutor = pool,
): Promise<SupplierOrder> => {
  const { rows } = await exec.query<SupplierOrderRow>(
    `INSERT INTO supplier_sales
       (id, linked_quote_id, supplier_id, supplier_name, payment_terms, discount, discount_type, status, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${ORDER_COLUMNS}`,
    [
      input.id,
      input.linkedQuoteId,
      input.supplierId,
      input.supplierName,
      input.paymentTerms,
      input.discount,
      input.discountType,
      input.status,
      input.notes,
    ],
  );
  return mapOrder(rows[0]);
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
  exec: QueryExecutor = pool,
): Promise<SupplierOrder | null> => {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  const fields: Array<[string, unknown]> = [
    ['id', patch.id],
    ['supplier_id', patch.supplierId],
    ['supplier_name', patch.supplierName],
    ['payment_terms', patch.paymentTerms],
    ['discount', patch.discount],
    ['discount_type', patch.discountType],
    ['status', patch.status],
    ['notes', patch.notes],
  ];
  for (const [col, value] of fields) {
    if (value !== undefined) {
      sets.push(`${col} = $${idx++}`);
      params.push(value);
    }
  }

  if (sets.length === 0) {
    const { rows } = await exec.query<SupplierOrderRow>(
      `SELECT ${ORDER_COLUMNS} FROM supplier_sales WHERE id = $1`,
      [id],
    );
    return rows[0] ? mapOrder(rows[0]) : null;
  }

  sets.push(`updated_at = CURRENT_TIMESTAMP`);
  params.push(id);
  const { rows } = await exec.query<SupplierOrderRow>(
    `UPDATE supplier_sales SET ${sets.join(', ')} WHERE id = $${idx} RETURNING ${ORDER_COLUMNS}`,
    params,
  );
  return rows[0] ? mapOrder(rows[0]) : null;
};

export const deleteById = async (id: string, exec: QueryExecutor = pool): Promise<boolean> => {
  const { rowCount } = await exec.query(`DELETE FROM supplier_sales WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
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

export const replaceItems = async (
  orderId: string,
  items: NewSupplierOrderItem[],
  exec: QueryExecutor,
): Promise<SupplierOrderItem[]> => {
  await exec.query(`DELETE FROM supplier_sale_items WHERE sale_id = $1`, [orderId]);
  if (items.length === 0) return [];
  const placeholders = buildBulkInsertPlaceholders(items.length, 8);
  const params = items.flatMap((item) => [
    item.id,
    orderId,
    item.productId,
    item.productName,
    item.quantity,
    item.unitPrice,
    item.discount,
    item.note,
  ]);
  const { rows } = await exec.query<SupplierOrderItemRow>(
    `INSERT INTO supplier_sale_items
       (id, sale_id, product_id, product_name, quantity, unit_price, discount, note)
     VALUES ${placeholders}
     RETURNING ${ITEM_COLUMNS}`,
    params,
  );
  return rows.map(mapItem);
};
