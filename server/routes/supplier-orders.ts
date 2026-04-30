import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withTransaction } from '../db/index.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as supplierOrdersRepo from '../repositories/supplierOrdersRepo.ts';
import * as supplierQuotesRepo from '../repositories/supplierQuotesRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { isUniqueViolation } from '../utils/db-errors.ts';
import { generateItemId, generateSupplierOrderId } from '../utils/order-ids.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import {
  badRequest,
  optionalEnum,
  optionalLocalizedNonNegativeNumber,
  optionalNonEmptyString,
  parseLocalizedNonNegativeNumber,
  parseLocalizedPositiveNumber,
  requireNonEmptyString,
} from '../utils/validation.ts';

const SUPPLIER_ORDER_STATUSES = ['draft', 'sent'] as const;

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

const normalizeItems = (
  items: SupplierOrderItemInput[],
  reply: FastifyReply,
): supplierOrdersRepo.NewSupplierOrderItem[] | null => {
  const normalizedItems: supplierOrdersRepo.NewSupplierOrderItem[] = [];
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
      id: generateItemId('ssi-'),
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
      const [orders, items] = await Promise.all([
        supplierOrdersRepo.listAll(),
        supplierOrdersRepo.listAllItems(),
      ]);
      const itemsByOrder: Record<string, supplierOrdersRepo.SupplierOrderItem[]> = {};
      for (const item of items) {
        if (!itemsByOrder[item.orderId]) itemsByOrder[item.orderId] = [];
        itemsByOrder[item.orderId].push(item);
      }
      return orders.map((order) => ({
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

      const [sourceQuote, existingOrderId] = await Promise.all([
        supplierQuotesRepo.findById(linkedQuoteIdResult.value),
        supplierOrdersRepo.findExistingByLinkedQuote(linkedQuoteIdResult.value),
      ]);
      if (!sourceQuote) {
        return reply.code(404).send({ error: 'Source quote not found' });
      }
      if (sourceQuote.status !== 'accepted') {
        return reply
          .code(409)
          .send({ error: 'Supplier orders can only be created from accepted quotes' });
      }
      if (existingOrderId) {
        return reply.code(409).send({ error: 'A supplier order already exists for this quote' });
      }
      if (
        supplierIdResult.value !== sourceQuote.supplierId ||
        supplierNameResult.value !== sourceQuote.supplierName
      ) {
        return reply.code(409).send({ error: 'Supplier details must match the source quote' });
      }

      const discountResult = optionalLocalizedNonNegativeNumber(discount, 'discount');
      if (!discountResult.ok) return badRequest(reply, discountResult.message);
      const discountTypeValue = discountType === 'currency' ? 'currency' : 'percentage';
      const statusResult = optionalEnum(status, SUPPLIER_ORDER_STATUSES, 'status');
      if (!statusResult.ok) return badRequest(reply, statusResult.message);
      const normalizedItems = normalizeItems(items, reply);
      if (!normalizedItems) return;

      const orderId = nextIdResult.value || (await generateSupplierOrderId());

      let result: {
        order: supplierOrdersRepo.SupplierOrder;
        items: supplierOrdersRepo.SupplierOrderItem[];
      };
      try {
        result = await withTransaction(async (tx) => {
          const order = await supplierOrdersRepo.create(
            {
              id: orderId,
              linkedQuoteId: linkedQuoteIdResult.value,
              supplierId: supplierIdResult.value,
              supplierName: supplierNameResult.value,
              paymentTerms:
                typeof paymentTerms === 'string' && paymentTerms.length > 0
                  ? paymentTerms
                  : 'immediate',
              discount: discountResult.value || 0,
              discountType: discountTypeValue,
              status: statusResult.value || 'draft',
              notes: typeof notes === 'string' ? notes : null,
            },
            tx,
          );
          const createdItems = await supplierOrdersRepo.replaceItems(order.id, normalizedItems, tx);
          return { order, items: createdItems };
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          if (error.constraint === 'supplier_sales_pkey' || error.detail?.includes('(id)')) {
            return reply.code(409).send({ error: 'Order ID already exists' });
          }
          if (
            error.constraint === 'idx_supplier_sales_linked_quote_id_unique' ||
            error.detail?.includes('(linked_quote_id)')
          ) {
            return reply
              .code(409)
              .send({ error: 'A supplier order already exists for this quote' });
          }
        }
        throw error;
      }

      await logAudit({
        request,
        action: 'supplier_order.created',
        entityType: 'supplier_order',
        entityId: result.order.id,
        details: {
          targetLabel: result.order.id,
          secondaryLabel: result.order.supplierName,
        },
      });
      return reply.code(201).send({
        ...result.order,
        items: result.items,
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

      const patch: supplierOrdersRepo.SupplierOrderUpdate = {};

      let nextIdValue: string | null = null;
      if (nextId !== undefined) {
        const nextIdResult = optionalNonEmptyString(nextId, 'id');
        if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);
        nextIdValue = nextIdResult.value;
      }

      const [existingOrder, idConflict] = await Promise.all([
        supplierOrdersRepo.findExistingForUpdate(idResult.value),
        nextIdValue
          ? supplierOrdersRepo.findIdConflict(nextIdValue, idResult.value)
          : Promise.resolve(false),
      ]);

      if (!existingOrder) {
        return reply.code(404).send({ error: 'Order not found' });
      }
      if (idConflict) {
        return reply.code(409).send({ error: 'Order ID already exists' });
      }
      if (nextIdValue !== null) patch.id = nextIdValue;

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

      if (supplierId !== undefined) {
        const supplierIdResult = optionalNonEmptyString(supplierId, 'supplierId');
        if (!supplierIdResult.ok) return badRequest(reply, supplierIdResult.message);
        if (supplierIdResult.value !== null) patch.supplierId = supplierIdResult.value;
      }

      if (supplierName !== undefined) {
        const supplierNameResult = optionalNonEmptyString(supplierName, 'supplierName');
        if (!supplierNameResult.ok) return badRequest(reply, supplierNameResult.message);
        if (supplierNameResult.value !== null) patch.supplierName = supplierNameResult.value;
      }

      if (existingOrder.linkedQuoteId) {
        const lockedFields: string[] = [];
        if (patch.supplierId !== undefined && patch.supplierId !== existingOrder.supplierId) {
          lockedFields.push('supplierId');
        }
        if (patch.supplierName !== undefined && patch.supplierName !== existingOrder.supplierName) {
          lockedFields.push('supplierName');
        }
        if (lockedFields.length > 0) {
          return reply.code(409).send({
            error: 'Quote-linked order supplier details are read-only',
            fields: lockedFields,
          });
        }
      }

      if (discount !== undefined) {
        const discountResult = optionalLocalizedNonNegativeNumber(discount, 'discount');
        if (!discountResult.ok) return badRequest(reply, discountResult.message);
        if (discountResult.value !== null) patch.discount = discountResult.value;
      }

      if (discountType !== undefined) {
        patch.discountType = discountType === 'currency' ? 'currency' : 'percentage';
      }

      const statusResult = optionalEnum(status, SUPPLIER_ORDER_STATUSES, 'status');
      if (!statusResult.ok) return badRequest(reply, statusResult.message);
      if (statusResult.value !== null) patch.status = statusResult.value;

      if (typeof paymentTerms === 'string') patch.paymentTerms = paymentTerms;
      if (typeof notes === 'string') patch.notes = notes;

      let normalizedItems: supplierOrdersRepo.NewSupplierOrderItem[] | null = null;
      if (items !== undefined) {
        if (!Array.isArray(items) || items.length === 0) {
          return badRequest(reply, 'Items must be a non-empty array');
        }
        normalizedItems = normalizeItems(items, reply);
        if (!normalizedItems) return;
      }

      let updated: supplierOrdersRepo.SupplierOrder | null;
      let resultItems: supplierOrdersRepo.SupplierOrderItem[];
      try {
        const txResult = await withTransaction(async (tx) => {
          const order = await supplierOrdersRepo.update(idResult.value, patch, tx);
          if (!order) return { order: null, items: [] as supplierOrdersRepo.SupplierOrderItem[] };
          const finalItems = normalizedItems
            ? await supplierOrdersRepo.replaceItems(order.id, normalizedItems, tx)
            : await supplierOrdersRepo.findItemsForOrder(order.id, tx);
          return { order, items: finalItems };
        });
        updated = txResult.order;
        resultItems = txResult.items;
      } catch (error) {
        if (
          isUniqueViolation(error) &&
          (error.constraint === 'supplier_sales_pkey' || error.detail?.includes('(id)'))
        ) {
          return reply.code(409).send({ error: 'Order ID already exists' });
        }
        throw error;
      }

      if (!updated) {
        return reply.code(404).send({ error: 'Order not found' });
      }

      const didStatusChange =
        statusResult.value !== null && existingOrder.status !== updated.status;
      await logAudit({
        request,
        action: 'supplier_order.updated',
        entityType: 'supplier_order',
        entityId: updated.id,
        details: {
          targetLabel: updated.id,
          secondaryLabel: updated.supplierName,
          fromValue: didStatusChange ? existingOrder.status : undefined,
          toValue: didStatusChange ? updated.status : undefined,
        },
      });
      return {
        ...updated,
        items: resultItems,
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

      const [linkedInvoiceId, existing] = await Promise.all([
        supplierOrdersRepo.findLinkedInvoiceId(idResult.value),
        supplierOrdersRepo.findStatusAndSupplierName(idResult.value),
      ]);
      if (linkedInvoiceId) {
        return reply
          .code(409)
          .send({ error: 'Cannot delete an order once an invoice has been created from it' });
      }
      if (!existing) {
        return reply.code(404).send({ error: 'Order not found' });
      }
      if (existing.status !== 'draft') {
        return reply.code(409).send({ error: 'Only draft orders can be deleted' });
      }

      await logAudit({
        request,
        action: 'supplier_order.deleted',
        entityType: 'supplier_order',
        entityId: idResult.value,
        details: {
          targetLabel: idResult.value,
          secondaryLabel: existing.supplierName,
        },
      });
      await supplierOrdersRepo.deleteById(idResult.value);
      return reply.code(204).send();
    },
  );
}
