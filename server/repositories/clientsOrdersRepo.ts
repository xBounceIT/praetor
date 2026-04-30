import pool, { buildBulkInsertPlaceholders, type QueryExecutor } from '../db/index.ts';
import { parseDbNumber, parseNullableDbNumber } from '../utils/parse.ts';
import { normalizeUnitType, type UnitType } from '../utils/unit-type.ts';

export type ClientOrder = {
  id: string;
  linkedQuoteId: string | null;
  linkedOfferId: string | null;
  clientId: string;
  clientName: string;
  paymentTerms: string | null;
  discount: number;
  discountType: 'percentage' | 'currency';
  status: string;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ClientOrderItem = {
  id: string;
  orderId: string;
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
  supplierSaleId: string | null;
  supplierSaleItemId: string | null;
  supplierSaleSupplierName: string | null;
  unitType: UnitType;
  note: string | null;
  discount: number;
};

type ClientOrderRow = {
  id: string;
  linkedQuoteId: string | null;
  linkedOfferId: string | null;
  clientId: string;
  clientName: string;
  paymentTerms: string | null;
  discount: string | number;
  discountType: string;
  status: string;
  notes: string | null;
  createdAt: string | number;
  updatedAt: string | number;
};

type ClientOrderItemRow = {
  id: string;
  orderId: string;
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
  supplierSaleId: string | null;
  supplierSaleItemId: string | null;
  supplierSaleSupplierName: string | null;
  unitType: string | null;
  note: string | null;
  discount: string | number;
};

const ORDER_COLUMNS = `
  id,
  linked_quote_id as "linkedQuoteId",
  linked_offer_id as "linkedOfferId",
  client_id as "clientId",
  client_name as "clientName",
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
  product_cost as "productCost",
  product_mol_percentage as "productMolPercentage",
  supplier_quote_id as "supplierQuoteId",
  supplier_quote_item_id as "supplierQuoteItemId",
  supplier_quote_supplier_name as "supplierQuoteSupplierName",
  supplier_quote_unit_price as "supplierQuoteUnitPrice",
  supplier_sale_id as "supplierSaleId",
  supplier_sale_item_id as "supplierSaleItemId",
  supplier_sale_supplier_name as "supplierSaleSupplierName",
  unit_type as "unitType",
  note,
  discount
`;

const mapOrder = (row: ClientOrderRow): ClientOrder => ({
  id: row.id,
  linkedQuoteId: row.linkedQuoteId,
  linkedOfferId: row.linkedOfferId,
  clientId: row.clientId,
  clientName: row.clientName,
  paymentTerms: row.paymentTerms,
  discount: parseDbNumber(row.discount, 0),
  discountType: row.discountType === 'currency' ? 'currency' : 'percentage',
  status: row.status,
  notes: row.notes,
  createdAt: parseDbNumber(row.createdAt, 0),
  updatedAt: parseDbNumber(row.updatedAt, 0),
});

const mapItem = (row: ClientOrderItemRow): ClientOrderItem => ({
  id: row.id,
  orderId: row.orderId,
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
  supplierSaleId: row.supplierSaleId,
  supplierSaleItemId: row.supplierSaleItemId,
  supplierSaleSupplierName: row.supplierSaleSupplierName,
  unitType: normalizeUnitType(row.unitType),
  note: row.note,
  discount: parseDbNumber(row.discount, 0),
});

export const listAll = async (exec: QueryExecutor = pool): Promise<ClientOrder[]> => {
  const { rows } = await exec.query<ClientOrderRow>(
    `SELECT ${ORDER_COLUMNS} FROM sales ORDER BY created_at DESC`,
  );
  return rows.map(mapOrder);
};

export const listAllItems = async (exec: QueryExecutor = pool): Promise<ClientOrderItem[]> => {
  const { rows } = await exec.query<ClientOrderItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM sale_items ORDER BY created_at ASC`,
  );
  return rows.map(mapItem);
};

export const existsById = async (id: string, exec: QueryExecutor = pool): Promise<boolean> => {
  const { rows } = await exec.query<{ id: string }>(`SELECT id FROM sales WHERE id = $1`, [id]);
  return rows.length > 0;
};

export const findIdConflict = async (
  newId: string,
  currentId: string,
  exec: QueryExecutor = pool,
): Promise<boolean> => {
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM sales WHERE id = $1 AND id <> $2`,
    [newId, currentId],
  );
  return rows.length > 0;
};

export type ExistingClientOrder = {
  id: string;
  linkedQuoteId: string | null;
  linkedOfferId: string | null;
  clientId: string;
  clientName: string;
  paymentTerms: string | null;
  discount: number;
  status: string;
  notes: string | null;
};

export const findForUpdate = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<ExistingClientOrder | null> => {
  const { rows } = await exec.query<{
    id: string;
    linkedQuoteId: string | null;
    linkedOfferId: string | null;
    clientId: string;
    clientName: string;
    paymentTerms: string | null;
    discount: string | number;
    status: string;
    notes: string | null;
  }>(
    `SELECT id,
            linked_quote_id as "linkedQuoteId",
            linked_offer_id as "linkedOfferId",
            client_id as "clientId",
            client_name as "clientName",
            payment_terms as "paymentTerms",
            discount,
            status,
            notes
       FROM sales
      WHERE id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    linkedQuoteId: rows[0].linkedQuoteId,
    linkedOfferId: rows[0].linkedOfferId,
    clientId: rows[0].clientId,
    clientName: rows[0].clientName,
    paymentTerms: rows[0].paymentTerms,
    discount: parseDbNumber(rows[0].discount, 0),
    status: rows[0].status,
    notes: rows[0].notes,
  };
};

export const findStatusAndClientName = async (
  id: string,
  exec: QueryExecutor = pool,
): Promise<{ status: string; clientName: string } | null> => {
  const { rows } = await exec.query<{ status: string; clientName: string }>(
    `SELECT status, client_name as "clientName" FROM sales WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
};

export type OfferLink = {
  id: string;
  linkedQuoteId: string | null;
  status: string;
};

export const findOfferDetails = async (
  offerId: string,
  exec: QueryExecutor = pool,
): Promise<OfferLink | null> => {
  const { rows } = await exec.query<OfferLink>(
    `SELECT id, linked_quote_id as "linkedQuoteId", status FROM customer_offers WHERE id = $1`,
    [offerId],
  );
  return rows[0] ?? null;
};

export const findExistingForOffer = async (
  offerId: string,
  excludeOrderId: string | null = null,
  exec: QueryExecutor = pool,
): Promise<string | null> => {
  if (excludeOrderId) {
    const { rows } = await exec.query<{ id: string }>(
      `SELECT id FROM sales WHERE linked_offer_id = $1 AND id <> $2 LIMIT 1`,
      [offerId, excludeOrderId],
    );
    return rows[0]?.id ?? null;
  }
  const { rows } = await exec.query<{ id: string }>(
    `SELECT id FROM sales WHERE linked_offer_id = $1 LIMIT 1`,
    [offerId],
  );
  return rows[0]?.id ?? null;
};

export const findItemsForOrder = async (
  orderId: string,
  exec: QueryExecutor = pool,
): Promise<ClientOrderItem[]> => {
  const { rows } = await exec.query<ClientOrderItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM sale_items WHERE sale_id = $1 ORDER BY created_at ASC`,
    [orderId],
  );
  return rows.map(mapItem);
};

export type NewClientOrder = {
  id: string;
  linkedQuoteId: string | null;
  linkedOfferId: string | null;
  clientId: string;
  clientName: string;
  paymentTerms: string;
  discount: number;
  discountType: 'percentage' | 'currency';
  status: string;
  notes: string | null;
};

export const create = async (
  input: NewClientOrder,
  exec: QueryExecutor = pool,
): Promise<ClientOrder> => {
  const { rows } = await exec.query<ClientOrderRow>(
    `INSERT INTO sales (id, linked_quote_id, linked_offer_id, client_id, client_name, payment_terms, discount, discount_type, status, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${ORDER_COLUMNS}`,
    [
      input.id,
      input.linkedQuoteId,
      input.linkedOfferId,
      input.clientId,
      input.clientName,
      input.paymentTerms,
      input.discount,
      input.discountType,
      input.status,
      input.notes,
    ],
  );
  return mapOrder(rows[0]);
};

export type ClientOrderUpdate = {
  id?: string | null;
  linkedOfferId?: string | null;
  linkedQuoteId?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  paymentTerms?: string | null;
  discount?: number | null;
  discountType?: 'percentage' | 'currency' | null;
  status?: string | null;
  notes?: string | null;
};

export const update = async (
  id: string,
  patch: ClientOrderUpdate,
  exec: QueryExecutor = pool,
): Promise<ClientOrder | null> => {
  const { rows } = await exec.query<ClientOrderRow>(
    `UPDATE sales
        SET id = COALESCE($1, id),
            linked_offer_id = COALESCE($2, linked_offer_id),
            linked_quote_id = COALESCE($3, linked_quote_id),
            client_id = COALESCE($4, client_id),
            client_name = COALESCE($5, client_name),
            payment_terms = COALESCE($6, payment_terms),
            discount = COALESCE($7, discount),
            discount_type = COALESCE($8, discount_type),
            status = COALESCE($9, status),
            notes = COALESCE($10, notes),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $11
      RETURNING ${ORDER_COLUMNS}`,
    [
      patch.id ?? null,
      patch.linkedOfferId ?? null,
      patch.linkedQuoteId ?? null,
      patch.clientId ?? null,
      patch.clientName ?? null,
      patch.paymentTerms ?? null,
      patch.discount ?? null,
      patch.discountType ?? null,
      patch.status ?? null,
      patch.notes ?? null,
      id,
    ],
  );
  return rows[0] ? mapOrder(rows[0]) : null;
};

export type NewClientOrderItem = {
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
  supplierSaleId: string | null;
  supplierSaleItemId: string | null;
  supplierSaleSupplierName: string | null;
  unitType: UnitType;
};

const buildItemInsertSql = (rowCount: number) =>
  `INSERT INTO sale_items
       (id, sale_id, product_id, product_name, quantity, unit_price, product_cost,
        product_mol_percentage, discount, note,
        supplier_quote_id, supplier_quote_item_id, supplier_quote_supplier_name,
        supplier_quote_unit_price,
        supplier_sale_id, supplier_sale_item_id, supplier_sale_supplier_name,
        unit_type)
     VALUES ${buildBulkInsertPlaceholders(rowCount, 18)}
     RETURNING ${ITEM_COLUMNS}`;

const itemInsertParams = (orderId: string, items: NewClientOrderItem[]) =>
  items.flatMap((item) => [
    item.id,
    orderId,
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
    item.supplierSaleId,
    item.supplierSaleItemId,
    item.supplierSaleSupplierName,
    item.unitType,
  ]);

export const insertItems = async (
  orderId: string,
  items: NewClientOrderItem[],
  exec: QueryExecutor = pool,
): Promise<ClientOrderItem[]> => {
  if (items.length === 0) return [];
  const { rows } = await exec.query<ClientOrderItemRow>(
    buildItemInsertSql(items.length),
    itemInsertParams(orderId, items),
  );
  return rows.map(mapItem);
};

export const replaceItems = async (
  orderId: string,
  items: NewClientOrderItem[],
  exec: QueryExecutor = pool,
): Promise<ClientOrderItem[]> => {
  await exec.query(`DELETE FROM sale_items WHERE sale_id = $1`, [orderId]);
  return insertItems(orderId, items, exec);
};

export const deleteById = async (id: string, exec: QueryExecutor = pool): Promise<boolean> => {
  const { rowCount } = await exec.query(`DELETE FROM sales WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
};

export type NewSupplierOrderForAutoCreate = {
  id: string;
  linkedQuoteId: string;
  supplierId: string;
  supplierName: string;
  paymentTerms: string;
  notes: string | null;
};

export const createSupplierOrder = async (
  input: NewSupplierOrderForAutoCreate,
  exec: QueryExecutor,
): Promise<void> => {
  await exec.query(
    `INSERT INTO supplier_sales
        (id, linked_quote_id, supplier_id, supplier_name, payment_terms, status, notes)
     VALUES ($1, $2, $3, $4, $5, 'draft', $6)`,
    [
      input.id,
      input.linkedQuoteId,
      input.supplierId,
      input.supplierName,
      input.paymentTerms,
      input.notes,
    ],
  );
};

export type NewSupplierOrderItemForAutoCreate = {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  note: string | null;
};

export const bulkInsertSupplierOrderItems = async (
  supplierOrderId: string,
  items: NewSupplierOrderItemForAutoCreate[],
  exec: QueryExecutor,
): Promise<void> => {
  if (items.length === 0) return;
  const placeholders = buildBulkInsertPlaceholders(items.length, 7);
  const params = items.flatMap((item) => [
    item.id,
    supplierOrderId,
    item.productId,
    item.productName,
    item.quantity,
    item.unitPrice,
    item.note,
  ]);
  await exec.query(
    `INSERT INTO supplier_sale_items (id, sale_id, product_id, product_name, quantity, unit_price, note)
     VALUES ${placeholders}`,
    params,
  );
};

export const linkSaleItemsToSupplierOrder = async (
  args: {
    orderId: string;
    supplierQuoteId: string;
    supplierOrderId: string;
    supplierName: string;
  },
  exec: QueryExecutor,
): Promise<void> => {
  await exec.query(
    `UPDATE sale_items
        SET supplier_sale_id = $1,
            supplier_sale_supplier_name = $2
      WHERE sale_id = $3 AND supplier_quote_id = $4`,
    [args.supplierOrderId, args.supplierName, args.orderId, args.supplierQuoteId],
  );
};

export const mapSaleItemsToSupplierItems = async (
  args: {
    orderId: string;
    supplierQuoteId: string;
    mappings: Array<{ quoteItemId: string; saleItemId: string }>;
  },
  exec: QueryExecutor,
): Promise<void> => {
  if (args.mappings.length === 0) return;
  const valuesPlaceholders = buildBulkInsertPlaceholders(args.mappings.length, 2, 3);
  const mappingParams = args.mappings.flatMap(({ quoteItemId, saleItemId }) => [
    quoteItemId,
    saleItemId,
  ]);
  await exec.query(
    `UPDATE sale_items si
        SET supplier_sale_item_id = v.sale_item_id
      FROM (VALUES ${valuesPlaceholders}) v(quote_item_id, sale_item_id)
      WHERE si.sale_id = $1 AND si.supplier_quote_id = $2
        AND si.supplier_quote_item_id = v.quote_item_id`,
    [args.orderId, args.supplierQuoteId, ...mappingParams],
  );
};
