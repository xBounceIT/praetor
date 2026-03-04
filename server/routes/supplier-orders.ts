import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import { rateLimitErrorResponseSchema, standardErrorResponses } from '../schemas/common.ts';
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

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const itemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    orderId: { type: 'string' },
    productId: { type: ['string', 'null'] },
    productName: { type: 'string' },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    productTaxRate: { type: 'number' },
    note: { type: ['string', 'null'] },
    discount: { type: 'number' },
  },
  required: ['id', 'orderId', 'productName', 'quantity', 'unitPrice', 'discount'],
} as const;

const orderSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    linkedQuoteId: { type: ['string', 'null'] },
    linkedOfferId: { type: 'string' },
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    paymentTerms: { type: ['string', 'null'] },
    discount: { type: 'number' },
    status: { type: 'string' },
    notes: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    items: { type: 'array', items: itemSchema },
  },
  required: [
    'id',
    'linkedOfferId',
    'supplierId',
    'supplierName',
    'discount',
    'status',
    'createdAt',
    'updatedAt',
    'items',
  ],
} as const;

const itemBodySchema = {
  type: 'object',
  properties: {
    productId: { type: 'string' },
    productName: { type: 'string' },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    productTaxRate: { type: 'number' },
    discount: { type: 'number' },
    note: { type: 'string' },
  },
  required: ['productName', 'quantity', 'unitPrice'],
} as const;

const createBodySchema = {
  type: 'object',
  properties: {
    linkedQuoteId: { type: 'string' },
    linkedOfferId: { type: 'string' },
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    items: { type: 'array', items: itemBodySchema },
    paymentTerms: { type: 'string' },
    discount: { type: 'number' },
    status: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['linkedOfferId', 'supplierId', 'supplierName', 'items'],
} as const;

const updateBodySchema = {
  type: 'object',
  properties: {
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    items: { type: 'array', items: itemBodySchema },
    paymentTerms: { type: 'string' },
    discount: { type: 'number' },
    status: { type: 'string' },
    notes: { type: 'string' },
  },
} as const;

type SupplierOrderItemInput = {
  productId?: string;
  productName?: string;
  quantity?: string | number;
  unitPrice?: string | number;
  productTaxRate?: string | number;
  discount?: string | number;
  note?: string;
};

const normalizeItems = (items: SupplierOrderItemInput[], reply: FastifyReply) => {
  const normalizedItems: Array<Record<string, unknown>> = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const productNameResult = requireNonEmptyString(item.productName, `items[${i}].productName`);
    if (!productNameResult.ok) {
      badRequest(reply, productNameResult.message);
      return null;
    }
    const quantityResult = parseLocalizedPositiveNumber(item.quantity, `items[${i}].quantity`);
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
    const taxRateResult = optionalLocalizedNonNegativeNumber(
      item.productTaxRate,
      `items[${i}].productTaxRate`,
    );
    if (!taxRateResult.ok) {
      badRequest(reply, taxRateResult.message);
      return null;
    }
    const discountResult = optionalLocalizedNonNegativeNumber(
      item.discount,
      `items[${i}].discount`,
    );
    if (!discountResult.ok) {
      badRequest(reply, discountResult.message);
      return null;
    }
    normalizedItems.push({
      productId: item.productId || null,
      productName: productNameResult.value,
      quantity: quantityResult.value,
      unitPrice: unitPriceResult.value,
      productTaxRate: taxRateResult.value || 0,
      discount: discountResult.value || 0,
      note: item.note || null,
    });
  }
  return normalizedItems;
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.addHook('onRequest', authenticateToken);

  fastify.get(
    '/',
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute',
        },
      },
      onRequest: [requirePermission('accounting.supplier_orders.view')],
      schema: {
        tags: ['supplier-orders'],
        summary: 'List supplier sale orders',
        response: {
          200: { type: 'array', items: orderSchema },
          429: rateLimitErrorResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async () => {
      const ordersResult = await query(
        `SELECT
            id,
            linked_quote_id as "linkedQuoteId",
            linked_offer_id as "linkedOfferId",
            supplier_id as "supplierId",
            supplier_name as "supplierName",
            payment_terms as "paymentTerms",
            discount,
            status,
            notes,
            EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
            EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"
         FROM supplier_sales
         ORDER BY created_at DESC`,
      );

      const itemsResult = await query(
        `SELECT
            id,
            sale_id as "orderId",
            product_id as "productId",
            product_name as "productName",
            quantity,
            unit_price as "unitPrice",
            product_tax_rate as "productTaxRate",
            note,
            discount
         FROM supplier_sale_items
         ORDER BY created_at ASC`,
      );

      const itemsByOrder: Record<string, unknown[]> = {};
      itemsResult.rows.forEach((item: { orderId: string }) => {
        if (!itemsByOrder[item.orderId]) {
          itemsByOrder[item.orderId] = [];
        }
        itemsByOrder[item.orderId].push(item);
      });

      return ordersResult.rows.map((order: { id: string }) => ({
        ...order,
        items: itemsByOrder[order.id] || [],
      }));
    },
  );

  fastify.post(
    '/',
    {
      onRequest: [requirePermission('accounting.supplier_orders.create')],
      schema: {
        tags: ['supplier-orders'],
        summary: 'Create supplier sale order',
        body: createBodySchema,
        response: {
          201: orderSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        linkedQuoteId,
        linkedOfferId,
        supplierId,
        supplierName,
        items,
        paymentTerms,
        discount,
        status,
        notes,
      } = request.body as {
        linkedQuoteId?: unknown;
        linkedOfferId: unknown;
        supplierId: unknown;
        supplierName: unknown;
        items: SupplierOrderItemInput[] | unknown;
        paymentTerms: unknown;
        discount: unknown;
        status: unknown;
        notes: unknown;
      };

      const linkedOfferIdResult = requireNonEmptyString(linkedOfferId, 'linkedOfferId');
      if (!linkedOfferIdResult.ok) return badRequest(reply, linkedOfferIdResult.message);
      const linkedQuoteIdResult = optionalNonEmptyString(linkedQuoteId, 'linkedQuoteId');
      if (!linkedQuoteIdResult.ok) return badRequest(reply, linkedQuoteIdResult.message);
      const supplierIdResult = requireNonEmptyString(supplierId, 'supplierId');
      if (!supplierIdResult.ok) return badRequest(reply, supplierIdResult.message);
      const supplierNameResult = requireNonEmptyString(supplierName, 'supplierName');
      if (!supplierNameResult.ok) return badRequest(reply, supplierNameResult.message);
      if (!Array.isArray(items) || items.length === 0) {
        return badRequest(reply, 'Items must be a non-empty array');
      }

      const offerResult = await query(
        'SELECT id, linked_quote_id as "linkedQuoteId", status FROM supplier_offers WHERE id = $1',
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
        'SELECT id FROM supplier_sales WHERE linked_offer_id = $1 LIMIT 1',
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

      const discountResult = optionalLocalizedNonNegativeNumber(discount, 'discount');
      if (!discountResult.ok) return badRequest(reply, discountResult.message);
      const normalizedItems = normalizeItems(items, reply);
      if (!normalizedItems) return;

      const orderId = 'ss-' + Date.now();
      let createdOrderResult: Awaited<ReturnType<typeof query>>;
      try {
        createdOrderResult = await query(
          `INSERT INTO supplier_sales
            (id, linked_quote_id, linked_offer_id, supplier_id, supplier_name, payment_terms, discount, status, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING
              id,
              linked_quote_id as "linkedQuoteId",
              linked_offer_id as "linkedOfferId",
              supplier_id as "supplierId",
              supplier_name as "supplierName",
              payment_terms as "paymentTerms",
              discount,
              status,
              notes,
              EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
              EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
          [
            orderId,
            offerResult.rows[0].linkedQuoteId || null,
            linkedOfferIdResult.value,
            supplierIdResult.value,
            supplierNameResult.value,
            paymentTerms || 'immediate',
            discountResult.value || 0,
            status || 'draft',
            notes,
          ],
        );
      } catch (error) {
        const databaseError = error as DatabaseError;
        if (
          databaseError.code === '23505' &&
          (databaseError.constraint === 'idx_supplier_sales_linked_offer_id' ||
            databaseError.detail?.includes('(linked_offer_id)'))
        ) {
          return reply.code(409).send({ error: 'A sale order already exists for this offer' });
        }
        throw error;
      }

      const createdItems: unknown[] = [];
      for (const item of normalizedItems) {
        const itemId = 'ssi-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
        const itemResult = await query(
          `INSERT INTO supplier_sale_items
            (id, sale_id, product_id, product_name, quantity, unit_price, product_tax_rate, discount, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING
             id,
             sale_id as "orderId",
             product_id as "productId",
             product_name as "productName",
             quantity,
             unit_price as "unitPrice",
             product_tax_rate as "productTaxRate",
             discount,
             note`,
          [
            itemId,
            orderId,
            item.productId,
            item.productName,
            item.quantity,
            item.unitPrice,
            item.productTaxRate,
            item.discount,
            item.note,
          ],
        );
        createdItems.push(itemResult.rows[0]);
      }

      return reply.code(201).send({
        ...createdOrderResult.rows[0],
        items: createdItems,
      });
    },
  );

  fastify.put(
    '/:id',
    {
      onRequest: [requirePermission('accounting.supplier_orders.update')],
      schema: {
        tags: ['supplier-orders'],
        summary: 'Update supplier sale order',
        params: idParamSchema,
        body: updateBodySchema,
        response: {
          200: orderSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { supplierId, supplierName, items, paymentTerms, discount, status, notes } =
        request.body as {
          supplierId?: unknown;
          supplierName?: unknown;
          items?: SupplierOrderItemInput[] | unknown;
          paymentTerms?: unknown;
          discount?: unknown;
          status?: unknown;
          notes?: unknown;
        };

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const existingOrderResult = await query(
        `SELECT id, linked_offer_id as "linkedOfferId",
                supplier_id as "supplierId", supplier_name as "supplierName", status
         FROM supplier_sales WHERE id = $1`,
        [idResult.value],
      );
      if (existingOrderResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Order not found' });
      }

      const existingOrder = existingOrderResult.rows[0];

      const isStatusChangeOnly =
        status !== undefined &&
        supplierId === undefined &&
        supplierName === undefined &&
        items === undefined &&
        paymentTerms === undefined &&
        discount === undefined &&
        notes === undefined;
      if (existingOrder.status !== 'draft' && !isStatusChangeOnly) {
        return reply.code(409).send({
          error: 'Non-draft orders are read-only',
          currentStatus: existingOrder.status,
        });
      }

      let supplierIdValue = supplierId;
      if (supplierId !== undefined) {
        const supplierIdResult = optionalNonEmptyString(supplierId, 'supplierId');
        if (!supplierIdResult.ok) return badRequest(reply, supplierIdResult.message);
        supplierIdValue = supplierIdResult.value;
      }

      let supplierNameValue = supplierName;
      if (supplierName !== undefined) {
        const supplierNameResult = optionalNonEmptyString(supplierName, 'supplierName');
        if (!supplierNameResult.ok) return badRequest(reply, supplierNameResult.message);
        supplierNameValue = supplierNameResult.value;
      }

      if (existingOrder.linkedOfferId) {
        const lockedFields: string[] = [];
        if (
          supplierIdValue !== undefined &&
          supplierIdValue !== null &&
          supplierIdValue !== existingOrder.supplierId
        ) {
          lockedFields.push('supplierId');
        }
        if (
          supplierNameValue !== undefined &&
          supplierNameValue !== null &&
          supplierNameValue !== existingOrder.supplierName
        ) {
          lockedFields.push('supplierName');
        }
        if (lockedFields.length > 0) {
          return reply.code(409).send({
            error: 'Offer-linked order supplier details are read-only',
            fields: lockedFields,
          });
        }
      }

      let discountValue = discount;
      if (discount !== undefined) {
        const discountResult = optionalLocalizedNonNegativeNumber(discount, 'discount');
        if (!discountResult.ok) return badRequest(reply, discountResult.message);
        discountValue = discountResult.value;
      }

      const updatedOrderResult = await query(
        `UPDATE supplier_sales
         SET supplier_id = COALESCE($1, supplier_id),
             supplier_name = COALESCE($2, supplier_name),
             payment_terms = COALESCE($3, payment_terms),
             discount = COALESCE($4, discount),
             status = COALESCE($5, status),
             notes = COALESCE($6, notes),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $7
         RETURNING
            id,
            linked_quote_id as "linkedQuoteId",
            linked_offer_id as "linkedOfferId",
            supplier_id as "supplierId",
            supplier_name as "supplierName",
            payment_terms as "paymentTerms",
            discount,
            status,
            notes,
            EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
            EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
        [
          supplierIdValue,
          supplierNameValue,
          paymentTerms,
          discountValue,
          status,
          notes,
          idResult.value,
        ],
      );

      if (updatedOrderResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Order not found' });
      }

      let updatedItems: unknown[] = [];
      if (items !== undefined) {
        if (!Array.isArray(items) || items.length === 0) {
          return badRequest(reply, 'Items must be a non-empty array');
        }
        const normalizedItems = normalizeItems(items, reply);
        if (!normalizedItems) return;
        await query('DELETE FROM supplier_sale_items WHERE sale_id = $1', [idResult.value]);
        for (const item of normalizedItems) {
          const itemId = 'ssi-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
          const itemResult = await query(
            `INSERT INTO supplier_sale_items
              (id, sale_id, product_id, product_name, quantity, unit_price, product_tax_rate, discount, note)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING
               id,
               sale_id as "orderId",
               product_id as "productId",
               product_name as "productName",
               quantity,
               unit_price as "unitPrice",
               product_tax_rate as "productTaxRate",
               discount,
               note`,
            [
              itemId,
              idResult.value,
              item.productId,
              item.productName,
              item.quantity,
              item.unitPrice,
              item.productTaxRate,
              item.discount,
              item.note,
            ],
          );
          updatedItems.push(itemResult.rows[0]);
        }
      } else {
        const itemsResult = await query(
          `SELECT
              id,
              sale_id as "orderId",
              product_id as "productId",
              product_name as "productName",
              quantity,
              unit_price as "unitPrice",
              product_tax_rate as "productTaxRate",
              discount,
              note
           FROM supplier_sale_items
           WHERE sale_id = $1`,
          [idResult.value],
        );
        updatedItems = itemsResult.rows;
      }

      return {
        ...updatedOrderResult.rows[0],
        items: updatedItems,
      };
    },
  );

  fastify.delete(
    '/:id',
    {
      onRequest: [requirePermission('accounting.supplier_orders.delete')],
      schema: {
        tags: ['supplier-orders'],
        summary: 'Delete supplier sale order',
        params: idParamSchema,
        response: {
          204: { type: 'null' },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const linkedInvoiceResult = await query(
        'SELECT id FROM supplier_invoices WHERE linked_sale_id = $1 LIMIT 1',
        [idResult.value],
      );
      if (linkedInvoiceResult.rows.length > 0) {
        return reply
          .code(409)
          .send({ error: 'Cannot delete an order once an invoice has been created from it' });
      }

      const orderResult = await query('SELECT id, status FROM supplier_sales WHERE id = $1', [
        idResult.value,
      ]);
      if (orderResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Order not found' });
      }
      if (orderResult.rows[0].status !== 'draft') {
        return reply.code(409).send({ error: 'Only draft orders can be deleted' });
      }

      await query('DELETE FROM supplier_sales WHERE id = $1', [idResult.value]);
      return reply.code(204).send();
    },
  );
}
