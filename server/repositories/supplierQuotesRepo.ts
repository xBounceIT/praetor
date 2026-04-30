import pool, { type QueryExecutor } from '../db/index.ts';
import { normalizeNullableDateOnly } from '../utils/date.ts';
import { parseDbNumber } from '../utils/parse.ts';

export type SupplierQuote = {
  id: string;
  supplierId: string;
  supplierName: string;
  paymentTerms: string | null;
  status: string;
  expirationDate: string | null;
  linkedOrderId: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
};

export type SupplierQuoteItem = {
  id: string;
  quoteId: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  note: string | null;
  unitType: string;
};

type SupplierQuoteRow = {
  id: string;
  supplierId: string;
  supplierName: string;
  paymentTerms: string | null;
  status: string;
  expirationDate: string | Date | null;
  linkedOrderId: string | null;
  notes: string | null;
  createdAt: string | number;
  updatedAt: string | number;
};

type SupplierQuoteItemRow = {
  id: string;
  quoteId: string;
  productId: string | null;
  productName: string;
  quantity: string | number;
  unitPrice: string | number;
  note: string | null;
  unitType: string | null;
};

const QUOTE_BASE_COLUMNS = `
  id,
  supplier_id as "supplierId",
  supplier_name as "supplierName",
  payment_terms as "paymentTerms",
  status,
  expiration_date as "expirationDate",
  null::varchar as "linkedOrderId",
  notes,
  EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
  EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"
`;

const QUOTE_LIST_COLUMNS = `
  id,
  supplier_id as "supplierId",
  supplier_name as "supplierName",
  payment_terms as "paymentTerms",
  status,
  expiration_date as "expirationDate",
  (
    SELECT ss.id
    FROM supplier_sales ss
    WHERE ss.linked_quote_id = supplier_quotes.id
    LIMIT 1
  ) as "linkedOrderId",
  notes,
  EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
  EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"
`;

const ITEM_COLUMNS = `
  id,
  quote_id as "quoteId",
  product_id as "productId",
  product_name as "productName",
  quantity,
  unit_price as "unitPrice",
  note,
  unit_type as "unitType"
`;

const mapQuote = (row: SupplierQuoteRow): SupplierQuote => ({
  id: row.id,
  supplierId: row.supplierId,
  supplierName: row.supplierName,
  paymentTerms: row.paymentTerms,
  status: row.status,
  expirationDate: normalizeNullableDateOnly(row.expirationDate, 'supplierQuote.expirationDate'),
  linkedOrderId: row.linkedOrderId,
  notes: row.notes,
  createdAt: parseDbNumber(row.createdAt, 0),
  updatedAt: parseDbNumber(row.updatedAt, 0),
});

const mapItem = (row: SupplierQuoteItemRow): SupplierQuoteItem => ({
  id: row.id,
  quoteId: row.quoteId,
  productId: row.productId,
  productName: row.productName,
  quantity: parseDbNumber(row.quantity, 0),
  unitPrice: parseDbNumber(row.unitPrice, 0),
  note: row.note,
  unitType: row.unitType ?? 'unit',
});

export const listAll = async (exec: QueryExecutor = pool): Promise<SupplierQuote[]> => {
  const { rows } = await exec.query<SupplierQuoteRow>(
    `SELECT ${QUOTE_LIST_COLUMNS}
       FROM supplier_quotes
       ORDER BY created_at DESC`,
  );
  return rows.map(mapQuote);
};

export const listAllItems = async (exec: QueryExecutor = pool): Promise<SupplierQuoteItem[]> => {
  const { rows } = await exec.query<SupplierQuoteItemRow>(
    `SELECT ${ITEM_COLUMNS}
       FROM supplier_quote_items
       ORDER BY created_at ASC`,
  );
  return rows.map(mapItem);
};

export const findById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<SupplierQuote | null> => {
  const { rows } = await exec.query<SupplierQuoteRow>(
    `SELECT ${QUOTE_BASE_COLUMNS} FROM supplier_quotes WHERE id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  return mapQuote(rows[0]);
};

export const findItemsForQuote = async (
  quoteId: string,
  exec: QueryExecutor = pool,
): Promise<SupplierQuoteItem[]> => {
  const { rows } = await exec.query<SupplierQuoteItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM supplier_quote_items WHERE quote_id = $1`,
    [quoteId],
  );
  return rows.map(mapItem);
};

export const findLinkedOrderId = async (
  quoteId: string,
  exec: QueryExecutor = pool,
): Promise<string | null> => {
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM supplier_sales WHERE linked_quote_id = $1 LIMIT 1`,
    [quoteId],
  );
  return rows[0]?.id ?? null;
};

export const findIdConflict = async (
  newId: string,
  currentId: string,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM supplier_quotes WHERE id = $1 AND id <> $2`,
    [newId, currentId],
  );
  return rows.length > 0;
};

export type NewSupplierQuote = {
  id: string;
  supplierId: string;
  supplierName: string;
  paymentTerms: string;
  status: string;
  expirationDate: string;
  notes: string | null;
};

export const create = async (
  input: NewSupplierQuote,
  exec: QueryExecutor = pool,
): Promise<SupplierQuote> => {
  const { rows } = await exec.query<SupplierQuoteRow>(
    `INSERT INTO supplier_quotes (
       id, supplier_id, supplier_name, payment_terms, status, expiration_date, notes
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${QUOTE_BASE_COLUMNS}`,
    [
      input.id,
      input.supplierId,
      input.supplierName,
      input.paymentTerms,
      input.status,
      input.expirationDate,
      input.notes,
    ],
  );
  return mapQuote(rows[0]);
};

export type SupplierQuoteUpdate = {
  id?: string;
  supplierId?: string | null;
  supplierName?: string | null;
  paymentTerms?: string;
  status?: string;
  expirationDate?: string | null;
  notes?: string | null;
};

export const update = async (
  id: string,
  patch: SupplierQuoteUpdate,
  exec: QueryExecutor = pool,
): Promise<SupplierQuote | null> => {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  const fields: Array<[string, unknown]> = [
    ['id', patch.id],
    ['supplier_id', patch.supplierId],
    ['supplier_name', patch.supplierName],
    ['payment_terms', patch.paymentTerms],
    ['status', patch.status],
    ['expiration_date', patch.expirationDate],
    ['notes', patch.notes],
  ];
  for (const [col, value] of fields) {
    if (value !== undefined) {
      sets.push(`${col} = $${idx++}`);
      params.push(value);
    }
  }

  if (sets.length === 0) {
    const { rows } = await exec.query<SupplierQuoteRow>(
      `SELECT ${QUOTE_BASE_COLUMNS} FROM supplier_quotes WHERE id = $1`,
      [id],
    );
    if (!rows[0]) return null;
    return mapQuote(rows[0]);
  }

  sets.push(`updated_at = CURRENT_TIMESTAMP`);
  params.push(id);
  const { rows } = await exec.query<SupplierQuoteRow>(
    `UPDATE supplier_quotes SET ${sets.join(', ')} WHERE id = $${idx} RETURNING ${QUOTE_BASE_COLUMNS}`,
    params,
  );
  if (!rows[0]) return null;
  return mapQuote(rows[0]);
};

export const deleteById = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<{ supplierName: string } | null> => {
  const { rows } = await exec.query<{ supplier_name: string }>(
    `DELETE FROM supplier_quotes WHERE id = $1 RETURNING supplier_name`,
    [id],
  );
  if (!rows[0]) return null;
  return { supplierName: rows[0].supplier_name };
};

export type NewSupplierQuoteItem = {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  note: string | null;
  unitType: string;
};

export const replaceItems = async (
  quoteId: string,
  items: NewSupplierQuoteItem[],
  exec: QueryExecutor,
): Promise<SupplierQuoteItem[]> => {
  await exec.query(`DELETE FROM supplier_quote_items WHERE quote_id = $1`, [quoteId]);
  if (items.length === 0) return [];
  const FIELDS_PER_ROW = 8;
  const placeholders = items
    .map((_, i) => {
      const base = i * FIELDS_PER_ROW;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
    })
    .join(', ');
  const params = items.flatMap((item) => [
    item.id,
    quoteId,
    item.productId,
    item.productName,
    item.quantity,
    item.unitPrice,
    item.note,
    item.unitType,
  ]);
  const { rows } = await exec.query<SupplierQuoteItemRow>(
    `INSERT INTO supplier_quote_items (
       id, quote_id, product_id, product_name, quantity, unit_price, note, unit_type
     ) VALUES ${placeholders}
     RETURNING ${ITEM_COLUMNS}`,
    params,
  );
  return rows.map(mapItem);
};
