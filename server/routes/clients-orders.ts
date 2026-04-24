import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query, withTransaction } from '../db/index.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import {
  generateClientOrderId,
  generateItemId,
  generateSupplierOrderId,
} from '../utils/order-ids.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import {
  badRequest,
  optionalLocalizedNonNegativeNumber,
  optionalNonEmptyString,
  parseLocalizedNonNegativeNumber,
  parseLocalizedPositiveNumber,
  requireNonEmptyString,
} from '../utils/validation.ts';

interface DatabaseError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
}

type UnitType = 'hours' | 'days' | 'unit';

const normalizeUnitType = (value: unknown): UnitType => {
  if (value === 'days') return 'days';
  if (value === 'unit') return 'unit';
  return 'hours';
};

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const clientOrderItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    orderId: { type: 'string' },
    productId: { type: ['string', 'null'] },
    productName: { type: 'string' },
    specialBidId: { type: ['string', 'null'] },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    productCost: { type: 'number' },
    productMolPercentage: { type: ['number', 'null'] },
    specialBidUnitPrice: { type: ['number', 'null'] },
    specialBidMolPercentage: { type: ['number', 'null'] },
    supplierQuoteId: { type: ['string', 'null'] },
    supplierQuoteItemId: { type: ['string', 'null'] },
    supplierQuoteSupplierName: { type: ['string', 'null'] },
    supplierQuoteUnitPrice: { type: ['number', 'null'] },
    unitType: { type: 'string', enum: ['hours', 'days', 'unit'] },
    note: { type: ['string', 'null'] },
    discount: { type: 'number' },
  },
  required: ['id', 'orderId', 'productName', 'quantity', 'unitPrice', 'productCost', 'discount'],
} as const;

const clientOrderSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    linkedQuoteId: { type: ['string', 'null'] },
    linkedOfferId: { type: ['string', 'null'] },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    paymentTerms: { type: ['string', 'null'] },
    discount: { type: 'number' },
    discountType: { type: 'string', enum: ['percentage', 'currency'] },
    status: { type: 'string' },
    notes: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    items: { type: 'array', items: clientOrderItemSchema },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'id',
    'clientId',
    'clientName',
    'discount',
    'discountType',
    'status',
    'createdAt',
    'updatedAt',
    'items',
  ],
} as const;

const clientOrderItemBodySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    productId: { type: 'string' },
    productName: { type: 'string' },
    specialBidId: { type: 'string' },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    productCost: { type: 'number' },
    productMolPercentage: { type: 'number' },
    specialBidUnitPrice: { type: 'number' },
    specialBidMolPercentage: { type: 'number' },
    supplierQuoteId: { type: 'string' },
    supplierQuoteItemId: { type: 'string' },
    supplierQuoteSupplierName: { type: 'string' },
    supplierQuoteUnitPrice: { type: 'number' },
    unitType: { type: 'string', enum: ['hours', 'days', 'unit'] },
    discount: { type: 'number' },
    note: { type: 'string' },
  },
  required: ['productName', 'quantity', 'unitPrice'],
} as const;

const clientOrderCreateBodySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    linkedQuoteId: { type: 'string' },
    linkedOfferId: { type: 'string' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    items: { type: 'array', items: clientOrderItemBodySchema },
    paymentTerms: { type: 'string' },
    discount: { type: 'number' },
    status: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['clientId', 'clientName', 'items'],
} as const;

const clientOrderUpdateBodySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    linkedOfferId: { type: 'string' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    items: { type: 'array', items: clientOrderItemBodySchema },
    paymentTerms: { type: 'string' },
    discount: { type: 'number' },
    status: { type: 'string' },
    notes: { type: 'string' },
  },
} as const;

const toFiniteNumber = (value: unknown, fieldName: string) => {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) {
    throw new TypeError(`Invalid numeric value for ${fieldName}`);
  }
  return parsedValue;
};

const toNullableFiniteNumber = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null) return null;
  return toFiniteNumber(value, fieldName);
};

const toNullableString = (value: unknown) => {
  if (value === undefined || value === null) return null;
  return String(value);
};

const normalizeClientOrderItemRow = (row: Record<string, unknown>) => ({
  id: String(row.id),
  orderId: String(row.orderId),
  productId: toNullableString(row.productId),
  productName: String(row.productName),
  specialBidId: toNullableString(row.specialBidId),
  quantity: toFiniteNumber(row.quantity, 'clientOrderItem.quantity'),
  unitPrice: toFiniteNumber(row.unitPrice, 'clientOrderItem.unitPrice'),
  productCost: toFiniteNumber(row.productCost, 'clientOrderItem.productCost'),
  productMolPercentage: toNullableFiniteNumber(
    row.productMolPercentage,
    'clientOrderItem.productMolPercentage',
  ),
  specialBidUnitPrice: toNullableFiniteNumber(
    row.specialBidUnitPrice,
    'clientOrderItem.specialBidUnitPrice',
  ),
  specialBidMolPercentage: toNullableFiniteNumber(
    row.specialBidMolPercentage,
    'clientOrderItem.specialBidMolPercentage',
  ),
  supplierQuoteId: toNullableString(row.supplierQuoteId),
  supplierQuoteItemId: toNullableString(row.supplierQuoteItemId),
  supplierQuoteSupplierName: toNullableString(row.supplierQuoteSupplierName),
  supplierQuoteUnitPrice: toNullableFiniteNumber(
    row.supplierQuoteUnitPrice,
    'clientOrderItem.supplierQuoteUnitPrice',
  ),
  unitType: normalizeUnitType(row.unitType),
  note: toNullableString(row.note),
  discount: toFiniteNumber(row.discount, 'clientOrderItem.discount'),
});

const normalizeClientOrderRow = (row: Record<string, unknown>) => ({
  id: String(row.id),
  linkedQuoteId: toNullableString(row.linkedQuoteId),
  linkedOfferId: toNullableString(row.linkedOfferId),
  clientId: String(row.clientId),
  clientName: String(row.clientName),
  paymentTerms: toNullableString(row.paymentTerms),
  discount: toFiniteNumber(row.discount, 'clientOrder.discount'),
  discountType: row.discountType === 'currency' ? 'currency' : 'percentage',
  status: String(row.status),
  notes: toNullableString(row.notes),
  createdAt: toFiniteNumber(row.createdAt, 'clientOrder.createdAt'),
  updatedAt: toFiniteNumber(row.updatedAt, 'clientOrder.updatedAt'),
});

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // All clients_orders routes require authentication
  fastify.addHook('onRequest', authenticateToken);
  // API path is clients-orders for backward compatibility; data is stored in sales/sale_items.

  // GET / - List all clients_orders with their items
  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('accounting.clients_orders.view'),
      ],
      schema: {
        tags: ['clients-orders'],
        summary: 'List client orders',
        response: {
          200: { type: 'array', items: clientOrderSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      // Get all clients_orders
      const clients_ordersResult = await query(
        `SELECT
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
            FROM sales
            ORDER BY created_at DESC`,
      );

      // Get all order items
      const itemsResult = await query(
        `SELECT
                id,
                sale_id as "orderId",
                product_id as "productId",
                product_name as "productName",
                special_bid_id as "specialBidId",
                quantity,
                unit_price as "unitPrice",
                product_cost as "productCost",
                product_mol_percentage as "productMolPercentage",
                special_bid_unit_price as "specialBidUnitPrice",
                special_bid_mol_percentage as "specialBidMolPercentage",
                supplier_quote_id as "supplierQuoteId",
                supplier_quote_item_id as "supplierQuoteItemId",
                supplier_quote_supplier_name as "supplierQuoteSupplierName",
                supplier_quote_unit_price as "supplierQuoteUnitPrice",
                unit_type as "unitType",
                note,
                discount
            FROM sale_items
            ORDER BY created_at ASC`,
      );

      const normalizedOrders = clients_ordersResult.rows.map((order) =>
        normalizeClientOrderRow(order as Record<string, unknown>),
      );
      const normalizedItems = itemsResult.rows.map((item) =>
        normalizeClientOrderItemRow(item as Record<string, unknown>),
      );

      // Group items by order
      const itemsByOrder: Record<string, ReturnType<typeof normalizeClientOrderItemRow>[]> = {};
      normalizedItems.forEach((item) => {
        if (!itemsByOrder[item.orderId]) {
          itemsByOrder[item.orderId] = [];
        }
        itemsByOrder[item.orderId].push(item);
      });

      // Attach items to clients_orders
      const clients_orders = normalizedOrders.map((order) => ({
        ...order,
        items: itemsByOrder[order.id] || [],
      }));

      return clients_orders;
    },
  );

  // POST / - Create order with items
  fastify.post(
    '/',
    {
      onRequest: [requirePermission('accounting.clients_orders.create')],
      schema: {
        tags: ['clients-orders'],
        summary: 'Create client order',
        body: clientOrderCreateBodySchema,
        response: {
          201: clientOrderSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        id: nextId,
        linkedQuoteId,
        linkedOfferId,
        clientId,
        clientName,
        items,
        paymentTerms,
        discount,
        discountType,
        status,
        notes,
      } = request.body as {
        id?: unknown;
        linkedQuoteId: unknown;
        linkedOfferId: unknown;
        clientId: unknown;
        clientName: unknown;
        items: unknown;
        paymentTerms: unknown;
        discount: unknown;
        discountType: unknown;
        status: unknown;
        notes: unknown;
      };

      const clientIdResult = requireNonEmptyString(clientId, 'clientId');
      if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);

      const clientNameResult = requireNonEmptyString(clientName, 'clientName');
      if (!clientNameResult.ok) return badRequest(reply, clientNameResult.message);

      const linkedOfferIdResult = optionalNonEmptyString(linkedOfferId, 'linkedOfferId');
      if (!linkedOfferIdResult.ok) return badRequest(reply, linkedOfferIdResult.message);
      const linkedQuoteIdResult = optionalNonEmptyString(linkedQuoteId, 'linkedQuoteId');
      if (!linkedQuoteIdResult.ok) return badRequest(reply, linkedQuoteIdResult.message);
      const nextIdResult = optionalNonEmptyString(nextId, 'id');
      if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);

      if (!Array.isArray(items) || items.length === 0) {
        return badRequest(reply, 'Items must be a non-empty array');
      }

      const normalizedItems = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const productNameResult = requireNonEmptyString(
          item.productName,
          `items[${i}].productName`,
        );
        if (!productNameResult.ok) return badRequest(reply, productNameResult.message);
        const quantityResult = parseLocalizedPositiveNumber(item.quantity, `items[${i}].quantity`);
        if (!quantityResult.ok) return badRequest(reply, quantityResult.message);
        const unitPriceResult = parseLocalizedNonNegativeNumber(
          item.unitPrice,
          `items[${i}].unitPrice`,
        );
        if (!unitPriceResult.ok) return badRequest(reply, unitPriceResult.message);
        const itemDiscountResult = optionalLocalizedNonNegativeNumber(
          item.discount,
          `items[${i}].discount`,
        );
        if (!itemDiscountResult.ok) return badRequest(reply, itemDiscountResult.message);
        normalizedItems.push({
          ...item,
          productName: productNameResult.value,
          quantity: quantityResult.value,
          unitPrice: unitPriceResult.value,
          productCost: Number(item.productCost ?? 0),
          productMolPercentage:
            item.productMolPercentage === undefined || item.productMolPercentage === null
              ? null
              : Number(item.productMolPercentage),
          specialBidUnitPrice:
            item.specialBidUnitPrice === undefined || item.specialBidUnitPrice === null
              ? null
              : Number(item.specialBidUnitPrice),
          specialBidMolPercentage:
            item.specialBidMolPercentage === undefined || item.specialBidMolPercentage === null
              ? null
              : Number(item.specialBidMolPercentage),
          unitType: normalizeUnitType(item.unitType),
          discount: itemDiscountResult.value || 0,
        });
      }

      const discountResult = optionalLocalizedNonNegativeNumber(discount, 'discount');
      if (!discountResult.ok) return badRequest(reply, discountResult.message);
      const discountTypeValue = discountType === 'currency' ? 'currency' : 'percentage';

      let linkedQuoteIdValue = linkedQuoteIdResult.value;
      if (linkedOfferIdResult.value) {
        const offerResult = await query(
          'SELECT id, linked_quote_id as "linkedQuoteId", status FROM customer_offers WHERE id = $1',
          [linkedOfferIdResult.value],
        );
        if (offerResult.rows.length === 0) {
          return reply.code(404).send({ error: 'Source offer not found' });
        }
        if (offerResult.rows[0].status !== 'accepted') {
          return reply
            .code(409)
            .send({ error: 'Sale orders can only be created from accepted offers' });
        }

        const existingOrderResult = await query(
          'SELECT id FROM sales WHERE linked_offer_id = $1 LIMIT 1',
          [linkedOfferIdResult.value],
        );
        if (existingOrderResult.rows.length > 0) {
          return reply.code(409).send({ error: 'A sale order already exists for this offer' });
        }

        if (
          linkedQuoteIdResult.value !== null &&
          linkedQuoteIdResult.value !== offerResult.rows[0].linkedQuoteId
        ) {
          return reply.code(409).send({ error: 'linkedQuoteId must match the source offer quote' });
        }

        linkedQuoteIdValue = offerResult.rows[0].linkedQuoteId || null;
      }

      const orderId = nextIdResult.value || (await generateClientOrderId());

      let orderResult: Awaited<ReturnType<typeof query>>;
      try {
        orderResult = await query(
          `INSERT INTO sales (id, linked_quote_id, linked_offer_id, client_id, client_name, payment_terms, discount, discount_type, status, notes)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               RETURNING
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
                  EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
          [
            orderId,
            linkedQuoteIdValue,
            linkedOfferIdResult.value || null,
            clientIdResult.value,
            clientNameResult.value,
            paymentTerms || 'immediate',
            discountResult.value || 0,
            discountTypeValue,
            status || 'draft',
            notes,
          ],
        );
      } catch (error) {
        const databaseError = error as DatabaseError;
        if (
          databaseError.code === '23505' &&
          (databaseError.constraint === 'sales_pkey' || databaseError.detail?.includes('(id)'))
        ) {
          return reply.code(409).send({ error: 'Order ID already exists' });
        }
        if (
          databaseError.code === '23505' &&
          (databaseError.constraint === 'idx_sales_linked_offer_id_unique' ||
            databaseError.detail?.includes('(linked_offer_id)'))
        ) {
          return reply.code(409).send({ error: 'A sale order already exists for this offer' });
        }
        throw error;
      }

      // Insert order items
      const createdItems: ReturnType<typeof normalizeClientOrderItemRow>[] = [];
      for (const item of normalizedItems) {
        const itemId = 'si-' + Date.now() + '-' + Math.random().toString(36).substring(2, 11);
        const itemResult = await query(
          `INSERT INTO sale_items (id, sale_id, product_id, product_name, special_bid_id, quantity, unit_price, product_cost, product_mol_percentage, special_bid_unit_price, special_bid_mol_percentage, discount, note, supplier_quote_id, supplier_quote_item_id, supplier_quote_supplier_name, supplier_quote_unit_price, unit_type)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                 RETURNING
                    id,
                    sale_id as "orderId",
                    product_id as "productId",
                    product_name as "productName",
                    special_bid_id as "specialBidId",
                    quantity,
                    unit_price as "unitPrice",
                    product_cost as "productCost",
                    product_mol_percentage as "productMolPercentage",
                    special_bid_unit_price as "specialBidUnitPrice",
                    special_bid_mol_percentage as "specialBidMolPercentage",
                    supplier_quote_id as "supplierQuoteId",
                    supplier_quote_item_id as "supplierQuoteItemId",
                    supplier_quote_supplier_name as "supplierQuoteSupplierName",
                    supplier_quote_unit_price as "supplierQuoteUnitPrice",
                    unit_type as "unitType",
                    discount,
                    note`,
          [
            itemId,
            orderId,
            item.productId,
            item.productName,
            item.specialBidId || null,
            item.quantity,
            item.unitPrice,
            item.productCost,
            item.productMolPercentage ?? null,
            item.specialBidUnitPrice ?? null,
            item.specialBidMolPercentage ?? null,
            item.discount || 0,
            item.note || null,
            item.supplierQuoteId ?? null,
            item.supplierQuoteItemId ?? null,
            item.supplierQuoteSupplierName ?? null,
            item.supplierQuoteUnitPrice ?? null,
            item.unitType || 'hours',
          ],
        );
        createdItems.push(
          normalizeClientOrderItemRow(itemResult.rows[0] as Record<string, unknown>),
        );
      }

      const supplierQuoteIds = [
        ...new Set(
          normalizedItems
            .map((item) => item.supplierQuoteId)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        ),
      ];

      const supplierOrderWarnings: string[] = [];

      for (const sqId of supplierQuoteIds) {
        try {
          const [sqResult, existingSupplierOrder, sqItems] = await Promise.all([
            query(
              `SELECT id, supplier_id as "supplierId", supplier_name as "supplierName",
                      payment_terms as "paymentTerms", notes, status
               FROM supplier_quotes WHERE id = $1`,
              [sqId],
            ),
            query('SELECT id FROM supplier_sales WHERE linked_quote_id = $1 LIMIT 1', [sqId]),
            query(
              `SELECT id, product_id as "productId", product_name as "productName",
                      quantity, unit_price as "unitPrice", note
               FROM supplier_quote_items WHERE quote_id = $1`,
              [sqId],
            ),
          ]);

          if (sqResult.rows.length === 0 || sqResult.rows[0].status !== 'accepted') continue;
          if (existingSupplierOrder.rows.length > 0) continue;

          const sq = sqResult.rows[0];
          const items = sqItems.rows;

          await withTransaction(async (tx) => {
            const supplierOrderId = await generateSupplierOrderId(tx);
            await tx.query(
              `INSERT INTO supplier_sales
                (id, linked_quote_id, supplier_id, supplier_name, payment_terms, status, notes)
               VALUES ($1, $2, $3, $4, $5, 'draft', $6)`,
              [
                supplierOrderId,
                sqId,
                sq.supplierId,
                sq.supplierName,
                sq.paymentTerms || 'immediate',
                sq.notes,
              ],
            );

            if (items.length > 0) {
              const placeholders = items
                .map(
                  (_, i) =>
                    `($${i * 7 + 1}, $${i * 7 + 2}, $${i * 7 + 3}, $${i * 7 + 4}, $${i * 7 + 5}, $${i * 7 + 6}, $${i * 7 + 7})`,
                )
                .join(', ');
              const params = items.flatMap((item) => [
                generateItemId('ssi-'),
                supplierOrderId,
                item.productId,
                item.productName,
                item.quantity,
                item.unitPrice,
                item.note,
              ]);
              await tx.query(
                `INSERT INTO supplier_sale_items (id, sale_id, product_id, product_name, quantity, unit_price, note)
                 VALUES ${placeholders}`,
                params,
              );
            }

            await logAudit({
              request,
              action: 'supplier_order.auto_created',
              entityType: 'supplier_order',
              entityId: supplierOrderId,
              details: {
                targetLabel: supplierOrderId,
                secondaryLabel: `${sq.supplierName} (from client order ${orderId}, supplier quote ${sqId})`,
              },
            });
          });
        } catch (err) {
          request.log.error({ err, supplierQuoteId: sqId }, 'Failed to auto-create supplier order');
          supplierOrderWarnings.push(`Failed to auto-create supplier order for quote ${sqId}`);
        }
      }

      await logAudit({
        request,
        action: 'client_order.created',
        entityType: 'client_order',
        entityId: orderId,
        details: {
          targetLabel: orderId,
          secondaryLabel: clientNameResult.value,
        },
      });
      return reply.code(201).send({
        ...normalizeClientOrderRow(orderResult.rows[0] as Record<string, unknown>),
        items: createdItems,
        ...(supplierOrderWarnings.length > 0 ? { warnings: supplierOrderWarnings } : {}),
      });
    },
  );

  // PUT /:id - Update order
  fastify.put(
    '/:id',
    {
      onRequest: [requirePermission('accounting.clients_orders.update')],
      schema: {
        tags: ['clients-orders'],
        summary: 'Update client order',
        params: idParamSchema,
        body: clientOrderUpdateBodySchema,
        response: {
          200: clientOrderSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const {
        id: nextId,
        linkedOfferId,
        clientId,
        clientName,
        items,
        paymentTerms,
        discount,
        discountType,
        status,
        notes,
      } = request.body as {
        id?: unknown;
        linkedOfferId: unknown;
        clientId: unknown;
        clientName: unknown;
        items: unknown;
        paymentTerms: unknown;
        discount: unknown;
        discountType: unknown;
        status: unknown;
        notes: unknown;
      };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      let nextIdValue = nextId;
      if (nextId !== undefined) {
        const nextIdResult = optionalNonEmptyString(nextId, 'id');
        if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);
        nextIdValue = nextIdResult.value;
        if (nextIdResult.value) {
          const existingIdResult = await query('SELECT id FROM sales WHERE id = $1 AND id <> $2', [
            nextIdResult.value,
            idResult.value,
          ]);
          if (existingIdResult.rows.length > 0) {
            return reply.code(409).send({ error: 'Order ID already exists' });
          }
        }
      }

      let clientIdValue = clientId;
      if (clientId !== undefined) {
        const clientIdResult = optionalNonEmptyString(clientId, 'clientId');
        if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);
        clientIdValue = clientIdResult.value;
      }

      let clientNameValue = clientName;
      if (clientName !== undefined) {
        const clientNameResult = optionalNonEmptyString(clientName, 'clientName');
        if (!clientNameResult.ok) return badRequest(reply, clientNameResult.message);
        clientNameValue = clientNameResult.value;
      }

      let discountValue = discount;
      if (discount !== undefined) {
        const discountResult = optionalLocalizedNonNegativeNumber(discount, 'discount');
        if (!discountResult.ok) return badRequest(reply, discountResult.message);
        discountValue = discountResult.value;
      }

      const discountTypeValue =
        discountType !== undefined
          ? discountType === 'currency'
            ? 'currency'
            : 'percentage'
          : undefined;

      let linkedOfferIdValue = linkedOfferId;
      if (linkedOfferId !== undefined) {
        const linkedOfferIdResult = optionalNonEmptyString(linkedOfferId, 'linkedOfferId');
        if (!linkedOfferIdResult.ok) return badRequest(reply, linkedOfferIdResult.message);
        linkedOfferIdValue = linkedOfferIdResult.value;
      }

      const normalizeNotesValue = (value: unknown) => String(value ?? '');
      const normalizeSpecialBidId = (value: unknown) => (value ? String(value) : '');
      const normalizeItemsForUpdate = (itemsToNormalize: unknown[]) => {
        if (!Array.isArray(itemsToNormalize) || itemsToNormalize.length === 0) {
          badRequest(reply, 'Items must be a non-empty array');
          return null;
        }

        const normalizedItems: Record<string, unknown>[] = [];
        for (let i = 0; i < itemsToNormalize.length; i++) {
          const item = itemsToNormalize[i] as Record<string, unknown>;
          const productNameResult = requireNonEmptyString(
            item.productName,
            `items[${i}].productName`,
          );
          if (!productNameResult.ok) {
            badRequest(reply, productNameResult.message);
            return null;
          }
          const quantityResult = parseLocalizedPositiveNumber(
            item.quantity,
            `items[${i}].quantity`,
          );
          if (!quantityResult.ok) {
            badRequest(reply, quantityResult.message);
            return null;
          }
          const unitPriceResult = parseLocalizedNonNegativeNumber(
            item.unitPrice,
            `items[${i}].unitPrice`,
          );
          if (!unitPriceResult.ok) {
            badRequest(reply, unitPriceResult.message);
            return null;
          }
          const itemDiscountResult = optionalLocalizedNonNegativeNumber(
            item.discount,
            `items[${i}].discount`,
          );
          if (!itemDiscountResult.ok) {
            badRequest(reply, itemDiscountResult.message);
            return null;
          }
          normalizedItems.push({
            ...item,
            productName: productNameResult.value,
            quantity: quantityResult.value,
            unitPrice: unitPriceResult.value,
            productCost: Number(item.productCost ?? 0),
            productMolPercentage:
              item.productMolPercentage === undefined || item.productMolPercentage === null
                ? null
                : Number(item.productMolPercentage),
            specialBidUnitPrice:
              item.specialBidUnitPrice === undefined || item.specialBidUnitPrice === null
                ? null
                : Number(item.specialBidUnitPrice),
            specialBidMolPercentage:
              item.specialBidMolPercentage === undefined || item.specialBidMolPercentage === null
                ? null
                : Number(item.specialBidMolPercentage),
            unitType: normalizeUnitType(item.unitType),
            discount: itemDiscountResult.value || 0,
          });
        }

        return normalizedItems;
      };

      const normalizeItemsForComparison = (itemsToNormalize: Record<string, unknown>[]) => {
        return itemsToNormalize
          .map((item) => {
            const normalized = {
              id: item.id ? String(item.id) : '',
              productId: item.productId ? String(item.productId) : '',
              productName: item.productName ? String(item.productName) : '',
              specialBidId: normalizeSpecialBidId(item.specialBidId as string | null | undefined),
              quantity: Number(item.quantity),
              unitPrice: Number(item.unitPrice),
              discount:
                item.discount !== undefined && item.discount !== null ? Number(item.discount) : 0,
            };
            const sortKey =
              normalized.id ||
              `${normalized.productId}|${normalized.productName}|${normalized.specialBidId}|${normalized.quantity}|${normalized.unitPrice}|${normalized.discount}`;
            return { ...normalized, sortKey };
          })
          .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
      };

      const itemsMatch = (
        leftItems: Record<string, unknown>[],
        rightItems: Record<string, unknown>[],
      ) => {
        if (leftItems.length !== rightItems.length) {
          return false;
        }
        for (let i = 0; i < leftItems.length; i++) {
          const leftItem = leftItems[i];
          const rightItem = rightItems[i];
          if (
            leftItem.id !== rightItem.id ||
            leftItem.productId !== rightItem.productId ||
            leftItem.productName !== rightItem.productName ||
            leftItem.specialBidId !== rightItem.specialBidId ||
            leftItem.quantity !== rightItem.quantity ||
            leftItem.unitPrice !== rightItem.unitPrice ||
            leftItem.discount !== rightItem.discount
          ) {
            return false;
          }
        }
        return true;
      };

      let normalizedItems: Record<string, unknown>[] | null = null;
      if (items !== undefined) {
        normalizedItems = normalizeItemsForUpdate(items as unknown[]);
        if (!normalizedItems) return;
      }

      const existingOrderResult = await query(
        `SELECT
                    id,
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
        [idResult.value],
      );

      if (existingOrderResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Order not found' });
      }

      const existingOrder = existingOrderResult.rows[0];
      let existingItems: Record<string, unknown>[] | null = null;

      // Check if order is read-only (non-draft status)
      // Status changes are always allowed, but other field changes are blocked for non-draft clients_orders
      const hasLockedFieldUpdates =
        linkedOfferId !== undefined ||
        clientIdValue !== undefined ||
        clientNameValue !== undefined ||
        paymentTerms !== undefined ||
        discountValue !== undefined ||
        notes !== undefined ||
        items !== undefined;

      if (existingOrder.status !== 'draft' && hasLockedFieldUpdates) {
        return reply.code(409).send({
          error: 'Non-draft clients_orders are read-only',
          currentStatus: existingOrder.status,
        });
      }

      const isSourceLinkedOrder = Boolean(
        existingOrder.linkedQuoteId || existingOrder.linkedOfferId,
      );

      if (isSourceLinkedOrder) {
        const lockedFields: string[] = [];

        if (
          clientIdValue !== undefined &&
          clientIdValue !== null &&
          clientIdValue !== existingOrder.clientId
        ) {
          lockedFields.push('clientId');
        }

        if (
          clientNameValue !== undefined &&
          clientNameValue !== null &&
          clientNameValue !== existingOrder.clientName
        ) {
          lockedFields.push('clientName');
        }

        if (
          paymentTerms !== undefined &&
          paymentTerms !== null &&
          paymentTerms !== existingOrder.paymentTerms
        ) {
          lockedFields.push('paymentTerms');
        }

        if (
          discountValue !== undefined &&
          discountValue !== null &&
          Number(discountValue) !== Number(existingOrder.discount)
        ) {
          lockedFields.push('discount');
        }

        if (
          notes !== undefined &&
          normalizeNotesValue(notes) !== normalizeNotesValue(existingOrder.notes)
        ) {
          lockedFields.push('notes');
        }

        if (items !== undefined) {
          const itemsResult = await query(
            `SELECT
                            id,
                            sale_id as "orderId",
                            product_id as "productId",
                            product_name as "productName",
                            special_bid_id as "specialBidId",
                            quantity,
                            unit_price as "unitPrice",
                            product_cost as "productCost",
                            product_mol_percentage as "productMolPercentage",
                            special_bid_unit_price as "specialBidUnitPrice",
                            special_bid_mol_percentage as "specialBidMolPercentage",
                            supplier_quote_id as "supplierQuoteId",
                            supplier_quote_item_id as "supplierQuoteItemId",
                            supplier_quote_supplier_name as "supplierQuoteSupplierName",
                            supplier_quote_unit_price as "supplierQuoteUnitPrice",
                            unit_type as "unitType",
                            discount,
                            note
                        FROM sale_items
                        WHERE sale_id = $1`,
            [idResult.value],
          );
          existingItems = itemsResult.rows;

          const normalizedExistingItems = normalizeItemsForComparison(
            existingItems as Record<string, unknown>[],
          );
          const normalizedIncomingItems = normalizeItemsForComparison(
            (normalizedItems ?? []) as Record<string, unknown>[],
          );
          if (!itemsMatch(normalizedExistingItems, normalizedIncomingItems)) {
            lockedFields.push('items');
          }
        }

        if (lockedFields.length > 0) {
          return reply.code(409).send({
            error: 'Quote-linked order details are read-only',
            fields: lockedFields,
          });
        }
      }

      let linkedQuoteIdValue: string | null = null;
      if (linkedOfferId !== undefined && linkedOfferIdValue) {
        if (existingOrder.linkedOfferId && existingOrder.linkedOfferId !== linkedOfferIdValue) {
          return reply.code(409).send({
            error: 'Orders cannot be relinked to a different offer',
          });
        }

        const offerResult = await query(
          'SELECT id, linked_quote_id as "linkedQuoteId", status FROM customer_offers WHERE id = $1',
          [linkedOfferIdValue],
        );
        if (offerResult.rows.length === 0) {
          return reply.code(404).send({ error: 'Source offer not found' });
        }
        if (offerResult.rows[0].status !== 'accepted') {
          return reply
            .code(409)
            .send({ error: 'Sale orders can only be created from accepted offers' });
        }
        if (
          existingOrder.linkedQuoteId &&
          existingOrder.linkedQuoteId !== offerResult.rows[0].linkedQuoteId
        ) {
          return reply.code(409).send({
            error: 'The selected offer does not match the order quote link',
          });
        }

        const existingLinkedOrderResult = await query(
          'SELECT id FROM sales WHERE linked_offer_id = $1 AND id <> $2 LIMIT 1',
          [linkedOfferIdValue, idResult.value],
        );
        if (existingLinkedOrderResult.rows.length > 0) {
          return reply.code(409).send({ error: 'A sale order already exists for this offer' });
        }

        linkedQuoteIdValue = offerResult.rows[0].linkedQuoteId || null;
      }

      // Update order
      let orderResult: Awaited<ReturnType<typeof query>>;
      try {
        orderResult = await query(
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
               RETURNING
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
                  EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
          [
            nextIdValue,
            linkedOfferIdValue,
            linkedQuoteIdValue,
            clientIdValue,
            clientNameValue,
            paymentTerms,
            discountValue,
            discountTypeValue,
            status,
            notes,
            idResult.value,
          ],
        );
      } catch (error) {
        const databaseError = error as DatabaseError;
        if (
          databaseError.code === '23505' &&
          (databaseError.constraint === 'sales_pkey' || databaseError.detail?.includes('(id)'))
        ) {
          return reply.code(409).send({ error: 'Order ID already exists' });
        }
        if (
          databaseError.code === '23505' &&
          (databaseError.constraint === 'idx_sales_linked_offer_id_unique' ||
            databaseError.detail?.includes('(linked_offer_id)'))
        ) {
          return reply.code(409).send({ error: 'A sale order already exists for this offer' });
        }
        throw error;
      }

      if (orderResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Order not found' });
      }

      const updatedOrderId = String(orderResult.rows[0].id);

      // If items are provided, update them
      let updatedItems: ReturnType<typeof normalizeClientOrderItemRow>[] = [];
      if (isSourceLinkedOrder) {
        if (existingItems) {
          updatedItems = existingItems.map((item) =>
            normalizeClientOrderItemRow(item as Record<string, unknown>),
          );
        } else {
          const itemsResult = await query(
            `SELECT
                        id,
                        sale_id as "orderId",
                        product_id as "productId",
                        product_name as "productName",
                        special_bid_id as "specialBidId",
                        quantity,
                        unit_price as "unitPrice",
                        product_cost as "productCost",
                        product_mol_percentage as "productMolPercentage",
                        special_bid_unit_price as "specialBidUnitPrice",
                        special_bid_mol_percentage as "specialBidMolPercentage",
                        supplier_quote_id as "supplierQuoteId",
                        supplier_quote_item_id as "supplierQuoteItemId",
                        supplier_quote_supplier_name as "supplierQuoteSupplierName",
                        supplier_quote_unit_price as "supplierQuoteUnitPrice",
                        unit_type as "unitType",
                        discount,
                         note
                     FROM sale_items
                     WHERE sale_id = $1`,
            [updatedOrderId],
          );
          updatedItems = itemsResult.rows.map((item) =>
            normalizeClientOrderItemRow(item as Record<string, unknown>),
          );
        }
      } else if (items !== undefined) {
        if (!normalizedItems) return;
        // Delete existing items
        await query('DELETE FROM sale_items WHERE sale_id = $1', [updatedOrderId]);

        // Insert new items
        for (const item of normalizedItems) {
          const itemId = 'si-' + Date.now() + '-' + Math.random().toString(36).substring(2, 11);
          const itemResult = await query(
            `INSERT INTO sale_items (id, sale_id, product_id, product_name, special_bid_id, quantity, unit_price, product_cost, product_mol_percentage, special_bid_unit_price, special_bid_mol_percentage, discount, note, supplier_quote_id, supplier_quote_item_id, supplier_quote_supplier_name, supplier_quote_unit_price, unit_type)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                     RETURNING
                        id,
                        sale_id as "orderId",
                        product_id as "productId",
                        product_name as "productName",
                        special_bid_id as "specialBidId",
                        quantity,
                        unit_price as "unitPrice",
                        product_cost as "productCost",
                        product_mol_percentage as "productMolPercentage",
                        special_bid_unit_price as "specialBidUnitPrice",
                        special_bid_mol_percentage as "specialBidMolPercentage",
                        supplier_quote_id as "supplierQuoteId",
                        supplier_quote_item_id as "supplierQuoteItemId",
                        supplier_quote_supplier_name as "supplierQuoteSupplierName",
                        supplier_quote_unit_price as "supplierQuoteUnitPrice",
                        unit_type as "unitType",
                        discount,
                         note`,
            [
              itemId,
              updatedOrderId,
              item.productId,
              item.productName,
              item.specialBidId || null,
              item.quantity,
              item.unitPrice,
              item.productCost,
              item.productMolPercentage ?? null,
              item.specialBidUnitPrice ?? null,
              item.specialBidMolPercentage ?? null,
              item.discount || 0,
              item.note || null,
              item.supplierQuoteId ?? null,
              item.supplierQuoteItemId ?? null,
              item.supplierQuoteSupplierName ?? null,
              item.supplierQuoteUnitPrice ?? null,
              item.unitType || 'hours',
            ],
          );
          updatedItems.push(
            normalizeClientOrderItemRow(itemResult.rows[0] as Record<string, unknown>),
          );
        }
      } else {
        // Fetch existing items
        const itemsResult = await query(
          `SELECT
                    id,
                    sale_id as "orderId",
                    product_id as "productId",
                    product_name as "productName",
                    special_bid_id as "specialBidId",
                    quantity,
                    unit_price as "unitPrice",
                    product_cost as "productCost",
                    product_mol_percentage as "productMolPercentage",
                    special_bid_unit_price as "specialBidUnitPrice",
                    special_bid_mol_percentage as "specialBidMolPercentage",
                    supplier_quote_id as "supplierQuoteId",
                    supplier_quote_item_id as "supplierQuoteItemId",
                    supplier_quote_supplier_name as "supplierQuoteSupplierName",
                    supplier_quote_unit_price as "supplierQuoteUnitPrice",
                    unit_type as "unitType",
                    discount,
                    note
                FROM sale_items
                WHERE sale_id = $1`,
          [updatedOrderId],
        );
        updatedItems = itemsResult.rows.map((item) =>
          normalizeClientOrderItemRow(item as Record<string, unknown>),
        );
      }

      const nextStatus =
        typeof status === 'string'
          ? status
          : String(orderResult.rows[0].status ?? existingOrder.status);
      const didStatusChange = status !== undefined && existingOrder.status !== nextStatus;

      await logAudit({
        request,
        action: 'client_order.updated',
        entityType: 'client_order',
        entityId: updatedOrderId,
        details: {
          targetLabel: updatedOrderId,
          secondaryLabel: String(orderResult.rows[0].clientName ?? ''),
          fromValue: didStatusChange ? String(existingOrder.status) : undefined,
          toValue: didStatusChange ? nextStatus : undefined,
        },
      });
      return {
        ...normalizeClientOrderRow(orderResult.rows[0] as Record<string, unknown>),
        items: updatedItems,
      };
    },
  );

  // DELETE /:id - Delete order (only allowed for draft status)
  fastify.delete(
    '/:id',
    {
      onRequest: [requirePermission('accounting.clients_orders.delete')],
      schema: {
        tags: ['clients-orders'],
        summary: 'Delete client order',
        params: idParamSchema,
        response: {
          204: { type: 'null' },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as unknown as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      // Check if order exists and is in draft status
      const orderResult = await query(
        'SELECT id, status, client_name as "clientName" FROM sales WHERE id = $1',
        [idResult.value],
      );

      if (orderResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Order not found' });
      }

      const order = orderResult.rows[0];
      if (order.status !== 'draft') {
        return reply.code(409).send({
          error: 'Only draft clients_orders can be deleted',
          currentStatus: order.status,
        });
      }

      // Items will be deleted automatically via CASCADE
      await query('DELETE FROM sales WHERE id = $1', [idResult.value]);

      await logAudit({
        request,
        action: 'client_order.deleted',
        entityType: 'client_order',
        entityId: idResult.value,
        details: {
          targetLabel: idResult.value,
          secondaryLabel: String(order.clientName ?? ''),
        },
      });
      return reply.code(204).send();
    },
  );
}
