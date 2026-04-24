import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { generateSupplierOrderId } from '../utils/order-ids.ts';
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
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    paymentTerms: { type: ['string', 'null'] },
    discount: { type: 'number' },
    discountType: { type: 'string', enum: ['percentage', 'currency'] },
    status: { type: 'string', enum: ['draft', 'sent'] },
    notes: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    items: { type: 'array', items: itemSchema },
  },
  required: [
    'id',
    'linkedQuoteId',
    'supplierId',
    'supplierName',
    'discount',
    'discountType',
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
    discount: { type: 'number' },
    note: { type: 'string' },
  },
  required: ['productName', 'quantity', 'unitPrice'],
} as const;

const createBodySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    linkedQuoteId: { type: 'string' },
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    items: { type: 'array', items: itemBodySchema },
    paymentTerms: { type: 'string' },
    discount: { type: 'number' },
    discountType: { type: 'string', enum: ['percentage', 'currency'] },
    status: { type: 'string', enum: ['draft', 'sent'] },
    notes: { type: 'string' },
  },
  required: ['linkedQuoteId', 'supplierId', 'supplierName', 'items'],
} as const;

const updateBodySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    items: { type: 'array', items: itemBodySchema },
    paymentTerms: { type: 'string' },
    discount: { type: 'number' },
    discountType: { type: 'string', enum: ['percentage', 'currency'] },
    status: { type: 'string', enum: ['draft', 'sent'] },
    notes: { type: 'string' },
  },
} as const;

type SupplierOrderItemInput = {
  productId?: string;
  productName?: string;
  quantity?: string | number;
  unitPrice?: string | number;
  discount?: string | number;
  note?: string;
};

const parseSupplierOrderStatus = (status: unknown) => {
  if (status === undefined || status === null || status === '') {
    return { ok: true as const, value: undefined };
  }

  if (status !== 'draft' && status !== 'sent') {
    return {
      ok: false as const,
      message: 'status must be one of: draft, sent',
    };
  }

  return {
    ok: true as const,
    value: status,
  };
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
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('accounting.supplier_orders.view'),
      ],
      schema: {
        tags: ['supplier-orders'],
        summary: 'List supplier sale orders',
        response: {
          200: { type: 'array', items: orderSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async () => {
      const ordersResult = await query(
        `SELECT
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
        id: nextId,
        linkedQuoteId,
        supplierId,
        supplierName,
        items,
        paymentTerms,
        discount,
        discountType,
        status,
        notes,
      } = request.body as {
        id?: unknown;
        linkedQuoteId: unknown;
        supplierId: unknown;
        supplierName: unknown;
        items: SupplierOrderItemInput[] | unknown;
        paymentTerms: unknown;
        discount: unknown;
        discountType: unknown;
        status: unknown;
        notes: unknown;
      };

      const linkedQuoteIdResult = requireNonEmptyString(linkedQuoteId, 'linkedQuoteId');
      if (!linkedQuoteIdResult.ok) return badRequest(reply, linkedQuoteIdResult.message);
      const supplierIdResult = requireNonEmptyString(supplierId, 'supplierId');
      if (!supplierIdResult.ok) return badRequest(reply, supplierIdResult.message);
      const supplierNameResult = requireNonEmptyString(supplierName, 'supplierName');
      if (!supplierNameResult.ok) return badRequest(reply, supplierNameResult.message);
      const nextIdResult = optionalNonEmptyString(nextId, 'id');
      if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);
      if (!Array.isArray(items) || items.length === 0) {
        return badRequest(reply, 'Items must be a non-empty array');
      }

      const quoteResult = await query(
        `SELECT
            id,
            supplier_id as "supplierId",
            supplier_name as "supplierName",
            status
         FROM supplier_quotes
         WHERE id = $1`,
        [linkedQuoteIdResult.value],
      );
      if (quoteResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Source quote not found' });
      }
      if (quoteResult.rows[0].status !== 'accepted') {
        return reply
          .code(409)
          .send({ error: 'Supplier orders can only be created from accepted quotes' });
      }

      const existingOrderResult = await query(
        'SELECT id FROM supplier_sales WHERE linked_quote_id = $1 LIMIT 1',
        [linkedQuoteIdResult.value],
      );
      if (existingOrderResult.rows.length > 0) {
        return reply.code(409).send({ error: 'A supplier order already exists for this quote' });
      }
      if (
        supplierIdResult.value !== quoteResult.rows[0].supplierId ||
        supplierNameResult.value !== quoteResult.rows[0].supplierName
      ) {
        return reply.code(409).send({ error: 'Supplier details must match the source quote' });
      }

      const discountResult = optionalLocalizedNonNegativeNumber(discount, 'discount');
      if (!discountResult.ok) return badRequest(reply, discountResult.message);
      const discountTypeValue = discountType === 'currency' ? 'currency' : 'percentage';
      const statusResult = parseSupplierOrderStatus(status);
      if (!statusResult.ok) return badRequest(reply, statusResult.message);
      const normalizedItems = normalizeItems(items, reply);
      if (!normalizedItems) return;

      const orderId = nextIdResult.value || (await generateSupplierOrderId());
      let createdOrderResult: Awaited<ReturnType<typeof query>>;
      try {
        createdOrderResult = await query(
          `INSERT INTO supplier_sales
            (id, linked_quote_id, supplier_id, supplier_name, payment_terms, discount, discount_type, status, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING
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
              EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
          [
            orderId,
            linkedQuoteIdResult.value,
            supplierIdResult.value,
            supplierNameResult.value,
            paymentTerms || 'immediate',
            discountResult.value || 0,
            discountTypeValue,
            statusResult.value || 'draft',
            notes,
          ],
        );
      } catch (error) {
        const databaseError = error as DatabaseError;
        if (
          databaseError.code === '23505' &&
          (databaseError.constraint === 'supplier_sales_pkey' ||
            databaseError.detail?.includes('(id)'))
        ) {
          return reply.code(409).send({ error: 'Order ID already exists' });
        }
        if (
          databaseError.code === '23505' &&
          (databaseError.constraint === 'idx_supplier_sales_linked_quote_id_unique' ||
            databaseError.detail?.includes('(linked_quote_id)'))
        ) {
          return reply.code(409).send({ error: 'A supplier order already exists for this quote' });
        }
        throw error;
      }

      const createdItems: unknown[] = [];
      for (const item of normalizedItems) {
        const itemId = 'ssi-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
        const itemResult = await query(
          `INSERT INTO supplier_sale_items
            (id, sale_id, product_id, product_name, quantity, unit_price, discount, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING
             id,
             sale_id as "orderId",
             product_id as "productId",
             product_name as "productName",
             quantity,
             unit_price as "unitPrice",
             discount,
             note`,
          [
            itemId,
            orderId,
            item.productId,
            item.productName,
            item.quantity,
            item.unitPrice,
            item.discount,
            item.note,
          ],
        );
        createdItems.push(itemResult.rows[0]);
      }

      await logAudit({
        request,
        action: 'supplier_order.created',
        entityType: 'supplier_order',
        entityId: orderId,
        details: {
          targetLabel: orderId,
          secondaryLabel: supplierNameResult.value,
        },
      });
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
      const {
        id: nextId,
        supplierId,
        supplierName,
        items,
        paymentTerms,
        discount,
        discountType,
        status,
        notes,
      } = request.body as {
        id?: unknown;
        supplierId?: unknown;
        supplierName?: unknown;
        items?: SupplierOrderItemInput[] | unknown;
        paymentTerms?: unknown;
        discount?: unknown;
        discountType?: unknown;
        status?: unknown;
        notes?: unknown;
      };

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      let nextIdValue = nextId;
      if (nextId !== undefined) {
        const nextIdResult = optionalNonEmptyString(nextId, 'id');
        if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);
        nextIdValue = nextIdResult.value;
        if (nextIdResult.value) {
          const existingIdResult = await query(
            'SELECT id FROM supplier_sales WHERE id = $1 AND id <> $2',
            [nextIdResult.value, idResult.value],
          );
          if (existingIdResult.rows.length > 0) {
            return reply.code(409).send({ error: 'Order ID already exists' });
          }
        }
      }

      const existingOrderResult = await query(
        `SELECT id,
                linked_quote_id as "linkedQuoteId",
                supplier_id as "supplierId", supplier_name as "supplierName", status
         FROM supplier_sales WHERE id = $1`,
        [idResult.value],
      );
      if (existingOrderResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Order not found' });
      }

      const existingOrder = existingOrderResult.rows[0];

      const hasLockedFieldUpdates =
        supplierId !== undefined ||
        supplierName !== undefined ||
        items !== undefined ||
        paymentTerms !== undefined ||
        discount !== undefined ||
        discountType !== undefined ||
        notes !== undefined;
      if (existingOrder.status !== 'draft' && hasLockedFieldUpdates) {
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

      if (existingOrder.linkedQuoteId) {
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
            error: 'Quote-linked order supplier details are read-only',
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

      const discountTypeValue =
        discountType !== undefined
          ? discountType === 'currency'
            ? 'currency'
            : 'percentage'
          : undefined;

      const statusResult = parseSupplierOrderStatus(status);
      if (!statusResult.ok) return badRequest(reply, statusResult.message);

      let updatedOrderResult: Awaited<ReturnType<typeof query>>;
      try {
        updatedOrderResult = await query(
          `UPDATE supplier_sales
           SET id = COALESCE($1, id),
               supplier_id = COALESCE($2, supplier_id),
               supplier_name = COALESCE($3, supplier_name),
               payment_terms = COALESCE($4, payment_terms),
               discount = COALESCE($5, discount),
               discount_type = COALESCE($6, discount_type),
               status = COALESCE($7, status),
               notes = COALESCE($8, notes),
               updated_at = CURRENT_TIMESTAMP
            WHERE id = $9
            RETURNING
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
              EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
          [
            nextIdValue,
            supplierIdValue,
            supplierNameValue,
            paymentTerms,
            discountValue,
            discountTypeValue,
            statusResult.value,
            notes,
            idResult.value,
          ],
        );
      } catch (error) {
        const databaseError = error as DatabaseError;
        if (
          databaseError.code === '23505' &&
          (databaseError.constraint === 'supplier_sales_pkey' ||
            databaseError.detail?.includes('(id)'))
        ) {
          return reply.code(409).send({ error: 'Order ID already exists' });
        }
        throw error;
      }

      if (updatedOrderResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Order not found' });
      }

      const updatedOrderId = String(updatedOrderResult.rows[0].id);

      let updatedItems: unknown[] = [];
      if (items !== undefined) {
        if (!Array.isArray(items) || items.length === 0) {
          return badRequest(reply, 'Items must be a non-empty array');
        }
        const normalizedItems = normalizeItems(items, reply);
        if (!normalizedItems) return;
        await query('DELETE FROM supplier_sale_items WHERE sale_id = $1', [updatedOrderId]);
        for (const item of normalizedItems) {
          const itemId = 'ssi-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
          const itemResult = await query(
            `INSERT INTO supplier_sale_items
              (id, sale_id, product_id, product_name, quantity, unit_price, discount, note)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING
               id,
               sale_id as "orderId",
               product_id as "productId",
               product_name as "productName",
               quantity,
               unit_price as "unitPrice",
               discount,
               note`,
            [
              itemId,
              updatedOrderId,
              item.productId,
              item.productName,
              item.quantity,
              item.unitPrice,
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
              discount,
              note
           FROM supplier_sale_items
           WHERE sale_id = $1`,
          [updatedOrderId],
        );
        updatedItems = itemsResult.rows;
      }

      const nextStatus = String(updatedOrderResult.rows[0].status ?? existingOrder.status);
      const didStatusChange =
        statusResult.value !== undefined && existingOrder.status !== nextStatus;
      await logAudit({
        request,
        action: 'supplier_order.updated',
        entityType: 'supplier_order',
        entityId: updatedOrderId,
        details: {
          targetLabel: updatedOrderId,
          secondaryLabel: String(updatedOrderResult.rows[0].supplierName ?? ''),
          fromValue: didStatusChange ? String(existingOrder.status) : undefined,
          toValue: didStatusChange ? nextStatus : undefined,
        },
      });
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

      const orderResult = await query(
        'SELECT id, status, supplier_name as "supplierName" FROM supplier_sales WHERE id = $1',
        [idResult.value],
      );
      if (orderResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Order not found' });
      }
      if (orderResult.rows[0].status !== 'draft') {
        return reply.code(409).send({ error: 'Only draft orders can be deleted' });
      }

      await logAudit({
        request,
        action: 'supplier_order.deleted',
        entityType: 'supplier_order',
        entityId: idResult.value,
        details: {
          targetLabel: idResult.value,
          secondaryLabel: String(orderResult.rows[0].supplierName ?? ''),
        },
      });
      await query('DELETE FROM supplier_sales WHERE id = $1', [idResult.value]);
      return reply.code(204).send();
    },
  );
}
