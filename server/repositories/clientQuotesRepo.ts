import pool, { buildBulkInsertPlaceholders, type QueryExecutor } from '../db/index.ts';
import { normalizeNullableDateOnly } from '../utils/date.ts';
import { parseDbNumber, parseNullableDbNumber } from '../utils/parse.ts';
import { normalizeUnitType, type UnitType } from '../utils/unit-type.ts';

export type ClientQuote = {
  id: string;
  linkedOfferId: string | null;
  clientId: string;
  clientName: string;
  paymentTerms: string | null;
  discount: number;
  discountType: 'percentage' | 'currency';
  status: string;
  expirationDate: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ClientQuoteItem = {
  id: string;
  quoteId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  productCost: number;
  productMolPercentage: number | null;
  supplierQuoteId: string | null;
  supplierQuoteItemId: string | null;
  supplierQuoteSupplierName: string | null;
  supplierQuoteUnitPrice: number | null;
  discount: number;
  note: string | null;
  unitType: UnitType;
};

type ClientQuoteRow = {
  id: string;
  linkedOfferId: string | null;
  clientId: string;
  clientName: string;
  paymentTerms: string | null;
  discount: string | number;
  discountType: string;
  status: string;
  expirationDate: string | Date | null;
  notes: string | null;
  createdAt: string | number;
  updatedAt: string | number;
};

type ClientQuoteItemRow = {
  id: string;
  quoteId: string;
  productId: string | null;
  productName: string;
  quantity: string | number;
  unitPrice: string | number;
  productCost: string | number;
  productMolPercentage: string | number | null;
  supplierQuoteId: string | null;
  supplierQuoteItemId: string | null;
  supplierQuoteSupplierName: string | null;
  supplierQuoteUnitPrice: string | number | null;
  discount: string | number;
  note: string | null;
  unitType: string | null;
};

const QUOTE_LIST_COLUMNS = `
  id,
  (
    SELECT co.id
    FROM customer_offers co
    WHERE co.linked_quote_id = quotes.id
    LIMIT 1
  ) as "linkedOfferId",
  client_id as "clientId",
  client_name as "clientName",
  payment_terms as "paymentTerms",
  discount,
  discount_type as "discountType",
  status,
  expiration_date as "expirationDate",
  notes,
  EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
  EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"
`;

const QUOTE_BASE_COLUMNS = `
  id,
  null::varchar as "linkedOfferId",
  client_id as "clientId",
  client_name as "clientName",
  payment_terms as "paymentTerms",
  discount,
  discount_type as "discountType",
  status,
  expiration_date as "expirationDate",
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
  product_cost as "productCost",
  product_mol_percentage as "productMolPercentage",
  supplier_quote_id as "supplierQuoteId",
  supplier_quote_item_id as "supplierQuoteItemId",
  supplier_quote_supplier_name as "supplierQuoteSupplierName",
  supplier_quote_unit_price as "supplierQuoteUnitPrice",
  discount,
  note,
  unit_type as "unitType"
`;

const mapQuote = (row: ClientQuoteRow): ClientQuote => ({
  id: row.id,
  linkedOfferId: row.linkedOfferId,
  clientId: row.clientId,
  clientName: row.clientName,
  paymentTerms: row.paymentTerms,
  discount: parseDbNumber(row.discount, 0),
  discountType: row.discountType === 'currency' ? 'currency' : 'percentage',
  status: row.status,
  expirationDate: normalizeNullableDateOnly(row.expirationDate, 'quote.expirationDate'),
  notes: row.notes,
  createdAt: parseDbNumber(row.createdAt, 0),
  updatedAt: parseDbNumber(row.updatedAt, 0),
});

const mapItem = (row: ClientQuoteItemRow): ClientQuoteItem => ({
  id: row.id,
  quoteId: row.quoteId,
  productId: row.productId ?? '',
  productName: row.productName,
  quantity: parseDbNumber(row.quantity, 0),
  unitPrice: parseDbNumber(row.unitPrice, 0),
  productCost: parseDbNumber(row.productCost, 0),
  productMolPercentage: parseNullableDbNumber(row.productMolPercentage),
  supplierQuoteId: row.supplierQuoteId,
  supplierQuoteItemId: row.supplierQuoteItemId,
  supplierQuoteSupplierName: row.supplierQuoteSupplierName,
  supplierQuoteUnitPrice: parseNullableDbNumber(row.supplierQuoteUnitPrice),
  discount: parseDbNumber(row.discount, 0),
  note: row.note,
  unitType: normalizeUnitType(row.unitType),
});

export const listAll = async (exec: QueryExecutor = pool): Promise<ClientQuote[]> => {
  const { rows } = await exec.query<ClientQuoteRow>(
    `SELECT ${QUOTE_LIST_COLUMNS} FROM quotes ORDER BY created_at DESC`,
  );
  return rows.map(mapQuote);
};

export const listAllItems = async (exec: QueryExecutor = pool): Promise<ClientQuoteItem[]> => {
  const { rows } = await exec.query<ClientQuoteItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM quote_items ORDER BY created_at ASC`,
  );
  return rows.map(mapItem);
};

export const existsById = async (id: string, exec: QueryExecutor = pool): Promise<boolean> => {
  const { rows } = await exec.query<{ id: string }>(`SELECT id FROM quotes WHERE id = $1`, [id]);
  return rows.length > 0;
};

export const findIdConflict = async (
  newId: string,
  currentId: string,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM quotes WHERE id = $1 AND id <> $2`,
    [newId, currentId],
  );
  return rows.length > 0;
};

export const findCurrentForUpdate = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<{
  status: string;
  discount: number;
  discountType: 'percentage' | 'currency';
} | null> => {
  const { rows } = await exec.query<{
    status: string;
    discount: string | number | null;
    discount_type: string | null;
  }>(`SELECT status, discount, discount_type FROM quotes WHERE id = $1`, [id]);
  if (rows.length === 0) return null;
  return {
    status: rows[0].status,
    discount: parseDbNumber(rows[0].discount, 0),
    discountType: rows[0].discount_type === 'currency' ? 'currency' : 'percentage',
  };
};

export const findStatusAndClientName = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<{ status: string; clientName: string } | null> => {
  const { rows } = await exec.query<{ status: string; clientName: string }>(
    `SELECT status, client_name as "clientName" FROM quotes WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
};

export const findLinkedOfferId = async (
  quoteId: string,
  exec: QueryExecutor = pool,
): Promise<string | null> => {
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM customer_offers WHERE linked_quote_id = $1 LIMIT 1`,
    [quoteId],
  );
  return rows[0]?.id ?? null;
};

export const findNonDraftLinkedSale = async (
  quoteId: string,
  exec: QueryExecutor = pool,
): Promise<string | null> => {
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM sales WHERE linked_quote_id = $1 AND status <> $2 LIMIT 1`,
    [quoteId, 'draft'],
  );
  return rows[0]?.id ?? null;
};

export const deleteDraftSalesForQuote = async (
  quoteId: string,
  exec: QueryExecutor = pool,
): Promise<void> => {
  await exec.query(`DELETE FROM sales WHERE linked_quote_id = $1 AND status = $2`, [
    quoteId,
    'draft',
  ]);
};

export const findAnyLinkedSale = async (
  quoteId: string,
  exec: QueryExecutor = pool,
): Promise<string | null> => {
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM sales WHERE linked_quote_id = $1 LIMIT 1`,
    [quoteId],
  );
  return rows[0]?.id ?? null;
};

export type ExistingQuoteItemSnapshot = {
  id: string;
  productId: string | null;
  productCost: number;
  productMolPercentage: number | null;
  supplierQuoteId: string | null;
  supplierQuoteItemId: string | null;
  supplierQuoteSupplierName: string | null;
  supplierQuoteUnitPrice: number | null;
  unitType: UnitType;
};

export const findItemSnapshotsForQuote = async (
  quoteId: string,
  exec: QueryExecutor = pool,
): Promise<ExistingQuoteItemSnapshot[]> => {
  const { rows } = await exec.query<{
    id: string;
    productId: string | null;
    productCost: string | number | null;
    productMolPercentage: string | number | null;
    supplierQuoteId: string | null;
    supplierQuoteItemId: string | null;
    supplierQuoteSupplierName: string | null;
    supplierQuoteUnitPrice: string | number | null;
    unitType: string | null;
  }>(
    `SELECT
        id,
        product_id as "productId",
        product_cost as "productCost",
        product_mol_percentage as "productMolPercentage",
        supplier_quote_id as "supplierQuoteId",
        supplier_quote_item_id as "supplierQuoteItemId",
        supplier_quote_supplier_name as "supplierQuoteSupplierName",
        supplier_quote_unit_price as "supplierQuoteUnitPrice",
        unit_type as "unitType"
       FROM quote_items
      WHERE quote_id = $1`,
    [quoteId],
  );
  return rows.map((row) => ({
    id: row.id,
    productId: row.productId,
    productCost: parseDbNumber(row.productCost, 0),
    productMolPercentage: parseNullableDbNumber(row.productMolPercentage),
    supplierQuoteId: row.supplierQuoteId,
    supplierQuoteItemId: row.supplierQuoteItemId,
    supplierQuoteSupplierName: row.supplierQuoteSupplierName,
    supplierQuoteUnitPrice: parseNullableDbNumber(row.supplierQuoteUnitPrice),
    unitType: normalizeUnitType(row.unitType),
  }));
};

export const findItemTotals = async (
  quoteId: string,
  exec: QueryExecutor = pool,
): Promise<Array<{ quantity: number; unitPrice: number; discount: number }>> => {
  const { rows } = await exec.query<{
    quantity: string | number;
    unitPrice: string | number;
    discount: string | number | null;
  }>(`SELECT quantity, unit_price as "unitPrice", discount FROM quote_items WHERE quote_id = $1`, [
    quoteId,
  ]);
  return rows.map((row) => ({
    quantity: parseDbNumber(row.quantity, 0),
    unitPrice: parseDbNumber(row.unitPrice, 0),
    discount: parseDbNumber(row.discount, 0),
  }));
};

export const findItemsForQuote = async (
  quoteId: string,
  exec: QueryExecutor = pool,
): Promise<ClientQuoteItem[]> => {
  const { rows } = await exec.query<ClientQuoteItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM quote_items WHERE quote_id = $1`,
    [quoteId],
  );
  return rows.map(mapItem);
};

export type NewClientQuote = {
  id: string;
  clientId: string;
  clientName: string;
  paymentTerms: string;
  discount: number;
  discountType: 'percentage' | 'currency';
  status: string;
  expirationDate: string;
  notes: string | null;
};

export const create = async (
  input: NewClientQuote,
  exec: QueryExecutor = pool,
): Promise<ClientQuote> => {
  const { rows } = await exec.query<ClientQuoteRow>(
    `INSERT INTO quotes (id, client_id, client_name, payment_terms, discount, discount_type, status, expiration_date, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${QUOTE_BASE_COLUMNS}`,
    [
      input.id,
      input.clientId,
      input.clientName,
      input.paymentTerms,
      input.discount,
      input.discountType,
      input.status,
      input.expirationDate,
      input.notes,
    ],
  );
  return mapQuote(rows[0]);
};

export type ClientQuoteUpdate = {
  id?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  paymentTerms?: string | null;
  discount?: number | null;
  discountType?: 'percentage' | 'currency' | null;
  status?: string | null;
  expirationDate?: string | null;
  notes?: string | null;
};

export const update = async (
  id: string,
  patch: ClientQuoteUpdate,
  exec: QueryExecutor = pool,
): Promise<ClientQuote | null> => {
  const { rows } = await exec.query<ClientQuoteRow>(
    `UPDATE quotes
        SET id = COALESCE($1, id),
            client_id = COALESCE($2, client_id),
            client_name = COALESCE($3, client_name),
            payment_terms = COALESCE($4, payment_terms),
            discount = COALESCE($5, discount),
            discount_type = COALESCE($6, discount_type),
            status = COALESCE($7, status),
            expiration_date = COALESCE($8, expiration_date),
            notes = COALESCE($9, notes),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $10
      RETURNING ${QUOTE_BASE_COLUMNS}`,
    [
      patch.id ?? null,
      patch.clientId ?? null,
      patch.clientName ?? null,
      patch.paymentTerms ?? null,
      patch.discount ?? null,
      patch.discountType ?? null,
      patch.status ?? null,
      patch.expirationDate ?? null,
      patch.notes ?? null,
      id,
    ],
  );
  return rows[0] ? mapQuote(rows[0]) : null;
};

export type NewClientQuoteItem = {
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
};

export const replaceItems = async (
  quoteId: string,
  items: NewClientQuoteItem[],
  exec: QueryExecutor = pool,
): Promise<ClientQuoteItem[]> => {
  await exec.query(`DELETE FROM quote_items WHERE quote_id = $1`, [quoteId]);
  if (items.length === 0) return [];
  const placeholders = buildBulkInsertPlaceholders(items.length, 15);
  const params = items.flatMap((item) => [
    item.id,
    quoteId,
    item.productId,
    item.productName,
    item.quantity,
    item.unitPrice,
    item.productCost,
    item.productMolPercentage,
    item.discount,
    item.note,
    item.supplierQuoteId,
    item.supplierQuoteItemId,
    item.supplierQuoteSupplierName,
    item.supplierQuoteUnitPrice,
    item.unitType,
  ]);
  const { rows } = await exec.query<ClientQuoteItemRow>(
    `INSERT INTO quote_items (
       id, quote_id, product_id, product_name,
       quantity, unit_price, product_cost, product_mol_percentage,
       discount, note,
       supplier_quote_id, supplier_quote_item_id, supplier_quote_supplier_name,
       supplier_quote_unit_price,
       unit_type
     ) VALUES ${placeholders}
     RETURNING ${ITEM_COLUMNS}`,
    params,
  );
  return rows.map(mapItem);
};

export const deleteById = async (id: string, exec: QueryExecutor = pool): Promise<boolean> => {
  const { rowCount } = await exec.query(`DELETE FROM quotes WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
};
