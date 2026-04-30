import pool, { buildBulkInsertPlaceholders, type QueryExecutor } from '../db/index.ts';
import { normalizeNullableDateOnly } from '../utils/date.ts';
import { parseDbNumber, parseNullableDbNumber } from '../utils/parse.ts';
import { normalizeUnitType, type UnitType } from '../utils/unit-type.ts';

export type ClientOffer = {
  id: string;
  linkedQuoteId: string;
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

export type ClientOfferItem = {
  id: string;
  offerId: string;
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
  unitType: UnitType;
  note: string | null;
  discount: number;
};

type ClientOfferRow = {
  id: string;
  linkedQuoteId: string;
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

type ClientOfferItemRow = {
  id: string;
  offerId: string;
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
  unitType: string | null;
  note: string | null;
  discount: string | number;
};

const OFFER_COLUMNS = `
  id,
  linked_quote_id as "linkedQuoteId",
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
  offer_id as "offerId",
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
  unit_type as "unitType",
  note,
  discount
`;

const mapOffer = (row: ClientOfferRow): ClientOffer => ({
  id: row.id,
  linkedQuoteId: row.linkedQuoteId,
  clientId: row.clientId,
  clientName: row.clientName,
  paymentTerms: row.paymentTerms,
  discount: parseDbNumber(row.discount, 0),
  discountType: row.discountType === 'currency' ? 'currency' : 'percentage',
  status: row.status,
  expirationDate: normalizeNullableDateOnly(row.expirationDate, 'offer.expirationDate'),
  notes: row.notes,
  createdAt: parseDbNumber(row.createdAt, 0),
  updatedAt: parseDbNumber(row.updatedAt, 0),
});

const mapItem = (row: ClientOfferItemRow): ClientOfferItem => ({
  id: row.id,
  offerId: row.offerId,
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
  unitType: normalizeUnitType(row.unitType),
  note: row.note,
  discount: parseDbNumber(row.discount, 0),
});

export const listAll = async (exec: QueryExecutor = pool): Promise<ClientOffer[]> => {
  const { rows } = await exec.query<ClientOfferRow>(
    `SELECT ${OFFER_COLUMNS} FROM customer_offers ORDER BY created_at DESC`,
  );
  return rows.map(mapOffer);
};

export const listAllItems = async (exec: QueryExecutor = pool): Promise<ClientOfferItem[]> => {
  const { rows } = await exec.query<ClientOfferItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM customer_offer_items ORDER BY created_at ASC`,
  );
  return rows.map(mapItem);
};

export const existsById = async (id: string, exec: QueryExecutor = pool): Promise<boolean> => {
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM customer_offers WHERE id = $1`,
    [id],
  );
  return rows.length > 0;
};

export const findIdConflict = async (
  newId: string,
  currentId: string,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM customer_offers WHERE id = $1 AND id <> $2`,
    [newId, currentId],
  );
  return rows.length > 0;
};

export type ExistingOffer = {
  id: string;
  linkedQuoteId: string | null;
  clientId: string;
  clientName: string;
  status: string;
};

export const findForUpdate = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<ExistingOffer | null> => {
  const { rows } = await exec.query<ExistingOffer>(
    `SELECT id,
            linked_quote_id as "linkedQuoteId",
            client_id as "clientId",
            client_name as "clientName",
            status
       FROM customer_offers
      WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
};

export const findStatusAndClientName = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<{ status: string; clientName: string } | null> => {
  const { rows } = await exec.query<{ status: string; clientName: string }>(
    `SELECT status, client_name as "clientName" FROM customer_offers WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
};

export const findExistingForQuote = async (
  quoteId: string,
  exec: QueryExecutor = pool,
): Promise<string | null> => {
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM customer_offers WHERE linked_quote_id = $1 LIMIT 1`,
    [quoteId],
  );
  return rows[0]?.id ?? null;
};

export const findLinkedSaleId = async (
  offerId: string,
  exec: QueryExecutor = pool,
): Promise<string | null> => {
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM sales WHERE linked_offer_id = $1 LIMIT 1`,
    [offerId],
  );
  return rows[0]?.id ?? null;
};

export const findItemsForOffer = async (
  offerId: string,
  exec: QueryExecutor = pool,
): Promise<ClientOfferItem[]> => {
  const { rows } = await exec.query<ClientOfferItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM customer_offer_items WHERE offer_id = $1`,
    [offerId],
  );
  return rows.map(mapItem);
};

export type NewClientOffer = {
  id: string;
  linkedQuoteId: string;
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
  input: NewClientOffer,
  exec: QueryExecutor = pool,
): Promise<ClientOffer> => {
  const { rows } = await exec.query<ClientOfferRow>(
    `INSERT INTO customer_offers
        (id, linked_quote_id, client_id, client_name, payment_terms, discount, discount_type, status, expiration_date, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${OFFER_COLUMNS}`,
    [
      input.id,
      input.linkedQuoteId,
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
  return mapOffer(rows[0]);
};

export type ClientOfferUpdate = {
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
  patch: ClientOfferUpdate,
  exec: QueryExecutor = pool,
): Promise<ClientOffer | null> => {
  const { rows } = await exec.query<ClientOfferRow>(
    `UPDATE customer_offers
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
      RETURNING ${OFFER_COLUMNS}`,
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
  return rows[0] ? mapOffer(rows[0]) : null;
};

export type NewClientOfferItem = {
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

export const insertItems = async (
  offerId: string,
  items: NewClientOfferItem[],
  exec: QueryExecutor = pool,
): Promise<ClientOfferItem[]> => {
  if (items.length === 0) return [];
  const placeholders = buildBulkInsertPlaceholders(items.length, 15);
  const params = items.flatMap((item) => [
    item.id,
    offerId,
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
  const { rows } = await exec.query<ClientOfferItemRow>(
    `INSERT INTO customer_offer_items
       (id, offer_id, product_id, product_name, quantity, unit_price, product_cost,
        product_mol_percentage, discount, note,
        supplier_quote_id, supplier_quote_item_id, supplier_quote_supplier_name,
        supplier_quote_unit_price, unit_type)
     VALUES ${placeholders}
     RETURNING ${ITEM_COLUMNS}`,
    params,
  );
  return rows.map(mapItem);
};

export const replaceItems = async (
  offerId: string,
  items: NewClientOfferItem[],
  exec: QueryExecutor = pool,
): Promise<ClientOfferItem[]> => {
  await exec.query(`DELETE FROM customer_offer_items WHERE offer_id = $1`, [offerId]);
  return insertItems(offerId, items, exec);
};

export const deleteById = async (id: string, exec: QueryExecutor = pool): Promise<boolean> => {
  const { rowCount } = await exec.query(`DELETE FROM customer_offers WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
};
