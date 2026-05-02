import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withDbTransaction } from '../db/drizzle.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as clientsOrdersRepo from '../repositories/clientsOrdersRepo.ts';
import * as supplierQuotesRepo from '../repositories/supplierQuotesRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { isUniqueViolation } from '../utils/db-errors.ts';
import {
  generateClientOrderId,
  generateItemId,
  generateSupplierOrderId,
} from '../utils/order-ids.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { normalizeUnitType, type UnitType } from '../utils/unit-type.ts';
import {
  badRequest,
  optionalLocalizedNonNegativeNumber,
  optionalNonEmptyString,
  parseLocalizedNonNegativeNumber,
  parseLocalizedPositiveNumber,
  requireNonEmptyString,
} from '../utils/validation.ts';

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
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    productCost: { type: 'number' },
    productMolPercentage: { type: ['number', 'null'] },
    supplierQuoteId: { type: ['string', 'null'] },
    supplierQuoteItemId: { type: ['string', 'null'] },
    supplierQuoteSupplierName: { type: ['string', 'null'] },
    supplierQuoteUnitPrice: { type: ['number', 'null'] },
    supplierSaleId: { type: ['string', 'null'] },
    supplierSaleItemId: { type: ['string', 'null'] },
    supplierSaleSupplierName: { type: ['string', 'null'] },
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
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    productCost: { type: 'number' },
    productMolPercentage: { type: 'number' },
    supplierQuoteId: { type: 'string' },
    supplierQuoteItemId: { type: 'string' },
    supplierQuoteSupplierName: { type: 'string' },
    supplierQuoteUnitPrice: { type: 'number' },
    supplierSaleId: { type: 'string' },
    supplierSaleItemId: { type: 'string' },
    supplierSaleSupplierName: { type: 'string' },
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
    discountType: { type: 'string', enum: ['percentage', 'currency'] },
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
    discountType: { type: 'string', enum: ['percentage', 'currency'] },
    status: { type: 'string' },
    notes: { type: 'string' },
  },
} as const;

type NormalizedOrderItem = {
  id?: string;
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

const normalizeIncomingItems = (
  items: unknown[],
  reply: FastifyReply,
): NormalizedOrderItem[] | null => {
  const normalized: NormalizedOrderItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as Record<string, unknown>;
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
    const itemDiscountResult = optionalLocalizedNonNegativeNumber(
      item.discount,
      `items[${i}].discount`,
    );
    if (!itemDiscountResult.ok) {
      badRequest(reply, itemDiscountResult.message);
      return null;
    }
    const toNullableString = (value: unknown) =>
      value === null || value === undefined ? null : String(value);
    const toNullableNumber = (value: unknown) =>
      value === null || value === undefined ? null : Number(value);
    normalized.push({
      id: typeof item.id === 'string' ? item.id : undefined,
      productId: toNullableString(item.productId),
      productName: productNameResult.value,
      quantity: quantityResult.value,
      unitPrice: unitPriceResult.value,
      productCost: Number(item.productCost ?? 0),
      productMolPercentage: toNullableNumber(item.productMolPercentage),
      supplierQuoteId: toNullableString(item.supplierQuoteId),
      supplierQuoteItemId: toNullableString(item.supplierQuoteItemId),
      supplierQuoteSupplierName: toNullableString(item.supplierQuoteSupplierName),
      supplierQuoteUnitPrice: toNullableNumber(item.supplierQuoteUnitPrice),
      supplierSaleId: toNullableString(item.supplierSaleId),
      supplierSaleItemId: toNullableString(item.supplierSaleItemId),
      supplierSaleSupplierName: toNullableString(item.supplierSaleSupplierName),
      unitType: normalizeUnitType(item.unitType),
      note: toNullableString(item.note),
      discount: itemDiscountResult.value || 0,
    });
  }
  return normalized;
};

const buildItemsForInsert = (
  items: NormalizedOrderItem[],
): clientsOrdersRepo.NewClientOrderItem[] =>
  items.map((item) => ({
    id: generateItemId('si-'),
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    productCost: item.productCost,
    productMolPercentage: item.productMolPercentage,
    discount: item.discount,
    note: item.note,
    supplierQuoteId: item.supplierQuoteId,
    supplierQuoteItemId: item.supplierQuoteItemId,
    supplierQuoteSupplierName: item.supplierQuoteSupplierName,
    supplierQuoteUnitPrice: item.supplierQuoteUnitPrice,
    supplierSaleId: item.supplierSaleId,
    supplierSaleItemId: item.supplierSaleItemId,
    supplierSaleSupplierName: item.supplierSaleSupplierName,
    unitType: item.unitType,
  }));

const normalizeNotesValue = (value: unknown) => String(value ?? '');

const normalizeItemsForComparison = (itemsToNormalize: Array<Record<string, unknown>>) =>
  itemsToNormalize
    .map((item) => {
      const normalized = {
        id: item.id ? String(item.id) : '',
        productId: item.productId ? String(item.productId) : '',
        productName: item.productName ? String(item.productName) : '',
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        discount: item.discount !== undefined && item.discount !== null ? Number(item.discount) : 0,
      };
      const sortKey =
        normalized.id ||
        `${normalized.productId}|${normalized.productName}|${normalized.quantity}|${normalized.unitPrice}|${normalized.discount}`;
      return { ...normalized, sortKey };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

const itemsMatch = (
  leftItems: Array<Record<string, unknown>>,
  rightItems: Array<Record<string, unknown>>,
) => {
  if (leftItems.length !== rightItems.length) return false;
  for (let i = 0; i < leftItems.length; i++) {
    const leftItem = leftItems[i];
    const rightItem = rightItems[i];
    if (
      leftItem.id !== rightItem.id ||
      leftItem.productId !== rightItem.productId ||
      leftItem.productName !== rightItem.productName ||
      leftItem.quantity !== rightItem.quantity ||
      leftItem.unitPrice !== rightItem.unitPrice ||
      leftItem.discount !== rightItem.discount
    ) {
      return false;
    }
  }
  return true;
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.addHook('onRequest', authenticateToken);
  // API path is clients-orders for backward compatibility; data is stored in sales/sale_items.

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
      const [orders, items] = await Promise.all([
        clientsOrdersRepo.listAll(),
        clientsOrdersRepo.listAllItems(),
      ]);

      const itemsByOrder = new Map<string, clientsOrdersRepo.ClientOrderItem[]>();
      for (const item of items) {
        const list = itemsByOrder.get(item.orderId);
        if (list) list.push(item);
        else itemsByOrder.set(item.orderId, [item]);
      }
      return orders.map((order) => ({
        ...order,
        items: itemsByOrder.get(order.id) ?? [],
      }));
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

      const normalizedItems = normalizeIncomingItems(items, reply);
      if (!normalizedItems) return;

      const discountResult = optionalLocalizedNonNegativeNumber(discount, 'discount');
      if (!discountResult.ok) return badRequest(reply, discountResult.message);
      const discountTypeValue = discountType === 'currency' ? 'currency' : 'percentage';

      let linkedQuoteIdValue = linkedQuoteIdResult.value;
      if (linkedOfferIdResult.value) {
        const offer = await clientsOrdersRepo.findOfferDetails(linkedOfferIdResult.value);
        if (!offer) {
          return reply.code(404).send({ error: 'Source offer not found' });
        }
        if (offer.status !== 'accepted') {
          return reply
            .code(409)
            .send({ error: 'Sale orders can only be created from accepted offers' });
        }

        if (await clientsOrdersRepo.findExistingForOffer(linkedOfferIdResult.value)) {
          return reply.code(409).send({ error: 'A sale order already exists for this offer' });
        }

        if (
          linkedQuoteIdResult.value !== null &&
          linkedQuoteIdResult.value !== offer.linkedQuoteId
        ) {
          return reply.code(409).send({ error: 'linkedQuoteId must match the source offer quote' });
        }

        linkedQuoteIdValue = offer.linkedQuoteId || null;
      }

      const orderId = nextIdResult.value || (await generateClientOrderId());

      let createdOrder: clientsOrdersRepo.ClientOrder;
      let insertedItems: clientsOrdersRepo.ClientOrderItem[];
      try {
        const result = await withDbTransaction(async (tx) => {
          const order = await clientsOrdersRepo.create(
            {
              id: orderId,
              linkedQuoteId: linkedQuoteIdValue,
              linkedOfferId: linkedOfferIdResult.value || null,
              clientId: clientIdResult.value,
              clientName: clientNameResult.value,
              paymentTerms:
                typeof paymentTerms === 'string' && paymentTerms ? paymentTerms : 'immediate',
              discount: discountResult.value || 0,
              discountType: discountTypeValue,
              status: typeof status === 'string' && status ? status : 'draft',
              notes: (notes as string | null | undefined) ?? null,
            },
            tx,
          );
          const items = await clientsOrdersRepo.insertItems(
            orderId,
            buildItemsForInsert(normalizedItems),
            tx,
          );
          return { order, items };
        });
        createdOrder = result.order;
        insertedItems = result.items;
      } catch (error) {
        if (isUniqueViolation(error)) {
          if (error.constraint === 'sales_pkey' || error.detail?.includes('(id)')) {
            return reply.code(409).send({ error: 'Order ID already exists' });
          }
          if (
            error.constraint === 'idx_sales_linked_offer_id_unique' ||
            error.detail?.includes('(linked_offer_id)')
          ) {
            return reply.code(409).send({ error: 'A sale order already exists for this offer' });
          }
        }
        throw error;
      }

      const supplierQuoteIds = [
        ...new Set(
          normalizedItems
            .map((item) => item.supplierQuoteId)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        ),
      ];

      const supplierOrderWarnings: string[] = [];
      let didAutoCreate = false;

      for (const sqId of supplierQuoteIds) {
        try {
          const [supplierQuote, existingSupplierOrderId, supplierItems] = await Promise.all([
            supplierQuotesRepo.findById(sqId),
            supplierQuotesRepo.findLinkedOrderId(sqId),
            supplierQuotesRepo.findItemsForQuote(sqId),
          ]);

          if (!supplierQuote || supplierQuote.status !== 'accepted') continue;
          if (existingSupplierOrderId) continue;

          await withDbTransaction(async (tx) => {
            const supplierOrderId = await generateSupplierOrderId(tx);
            await clientsOrdersRepo.createSupplierOrder(
              {
                id: supplierOrderId,
                linkedQuoteId: sqId,
                supplierId: supplierQuote.supplierId,
                supplierName: supplierQuote.supplierName,
                paymentTerms: supplierQuote.paymentTerms || 'immediate',
                notes: supplierQuote.notes,
              },
              tx,
            );

            const insertedSupplierItemIds: { quoteItemId: string; saleItemId: string }[] = [];
            const supplierItemRecords = supplierItems.map((item) => {
              const saleItemId = generateItemId('ssi-');
              insertedSupplierItemIds.push({ quoteItemId: item.id, saleItemId });
              return {
                id: saleItemId,
                productId: item.productId,
                productName: item.productName,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                note: item.note,
              };
            });

            await clientsOrdersRepo.bulkInsertSupplierOrderItems(
              supplierOrderId,
              supplierItemRecords,
              tx,
            );

            await clientsOrdersRepo.linkSaleItemsToSupplierOrder(
              {
                orderId,
                supplierQuoteId: sqId,
                supplierOrderId,
                supplierName: supplierQuote.supplierName,
              },
              tx,
            );

            await clientsOrdersRepo.mapSaleItemsToSupplierItems(
              {
                orderId,
                supplierQuoteId: sqId,
                mappings: insertedSupplierItemIds,
              },
              tx,
            );

            await logAudit({
              request,
              action: 'supplier_order.auto_created',
              entityType: 'supplier_order',
              entityId: supplierOrderId,
              details: {
                targetLabel: supplierOrderId,
                secondaryLabel: `${supplierQuote.supplierName} (from client order ${orderId}, supplier quote ${sqId})`,
              },
            });
          });
          didAutoCreate = true;
        } catch (err) {
          request.log.error({ err, supplierQuoteId: sqId }, 'Failed to auto-create supplier order');
          supplierOrderWarnings.push(`Failed to auto-create supplier order for quote ${sqId}`);
        }
      }

      const refreshedItems = didAutoCreate
        ? await clientsOrdersRepo.findItemsForOrder(orderId)
        : insertedItems;

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
        ...createdOrder,
        items: refreshedItems,
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

      let nextIdValue: string | null = null;
      if (nextId !== undefined) {
        const nextIdResult = optionalNonEmptyString(nextId, 'id');
        if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);
        nextIdValue = nextIdResult.value;
        if (nextIdResult.value) {
          if (await clientsOrdersRepo.findIdConflict(nextIdResult.value, idResult.value)) {
            return reply.code(409).send({ error: 'Order ID already exists' });
          }
        }
      }

      let clientIdValue: string | null | undefined = clientId as string | null | undefined;
      if (clientId !== undefined) {
        const clientIdResult = optionalNonEmptyString(clientId, 'clientId');
        if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);
        clientIdValue = clientIdResult.value;
      }

      let clientNameValue: string | null | undefined = clientName as string | null | undefined;
      if (clientName !== undefined) {
        const clientNameResult = optionalNonEmptyString(clientName, 'clientName');
        if (!clientNameResult.ok) return badRequest(reply, clientNameResult.message);
        clientNameValue = clientNameResult.value;
      }

      let discountValue: number | null | undefined = discount as number | null | undefined;
      if (discount !== undefined) {
        const discountResult = optionalLocalizedNonNegativeNumber(discount, 'discount');
        if (!discountResult.ok) return badRequest(reply, discountResult.message);
        discountValue = discountResult.value;
      }

      let discountTypeValue: 'currency' | 'percentage' | undefined;
      if (discountType !== undefined) {
        discountTypeValue = discountType === 'currency' ? 'currency' : 'percentage';
      }

      let linkedOfferIdValue: string | null | undefined = linkedOfferId as
        | string
        | null
        | undefined;
      if (linkedOfferId !== undefined) {
        const linkedOfferIdResult = optionalNonEmptyString(linkedOfferId, 'linkedOfferId');
        if (!linkedOfferIdResult.ok) return badRequest(reply, linkedOfferIdResult.message);
        linkedOfferIdValue = linkedOfferIdResult.value;
      }

      let normalizedItems: NormalizedOrderItem[] | null = null;
      if (items !== undefined) {
        if (!Array.isArray(items) || items.length === 0) {
          return badRequest(reply, 'Items must be a non-empty array');
        }
        normalizedItems = normalizeIncomingItems(items, reply);
        if (!normalizedItems) return;
      }

      const existingOrder = await clientsOrdersRepo.findForUpdate(idResult.value);
      if (!existingOrder) {
        return reply.code(404).send({ error: 'Order not found' });
      }

      const hasLockedFieldUpdates =
        linkedOfferId !== undefined ||
        clientIdValue !== undefined ||
        clientNameValue !== undefined ||
        paymentTerms !== undefined ||
        discountValue !== undefined ||
        discountType !== undefined ||
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

      let existingItems: clientsOrdersRepo.ClientOrderItem[] | null = null;

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
          existingItems = await clientsOrdersRepo.findItemsForOrder(idResult.value);
          const normalizedExistingItems = normalizeItemsForComparison(
            existingItems as unknown as Array<Record<string, unknown>>,
          );
          const normalizedIncomingItems = normalizeItemsForComparison(
            (normalizedItems ?? []) as unknown as Array<Record<string, unknown>>,
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

        const offer = await clientsOrdersRepo.findOfferDetails(linkedOfferIdValue);
        if (!offer) {
          return reply.code(404).send({ error: 'Source offer not found' });
        }
        if (offer.status !== 'accepted') {
          return reply
            .code(409)
            .send({ error: 'Sale orders can only be created from accepted offers' });
        }
        if (existingOrder.linkedQuoteId && existingOrder.linkedQuoteId !== offer.linkedQuoteId) {
          return reply.code(409).send({
            error: 'The selected offer does not match the order quote link',
          });
        }

        if (await clientsOrdersRepo.findExistingForOffer(linkedOfferIdValue, idResult.value)) {
          return reply.code(409).send({ error: 'A sale order already exists for this offer' });
        }

        linkedQuoteIdValue = offer.linkedQuoteId || null;
      }

      const willReplaceItems = !isSourceLinkedOrder && items !== undefined;

      let result: {
        order: clientsOrdersRepo.ClientOrder | null;
        items: clientsOrdersRepo.ClientOrderItem[];
      };
      try {
        result = await withDbTransaction(async (tx) => {
          const order = await clientsOrdersRepo.update(
            idResult.value,
            {
              id: nextIdValue,
              linkedOfferId: (linkedOfferIdValue as string | null | undefined) ?? null,
              linkedQuoteId: linkedQuoteIdValue,
              clientId: (clientIdValue as string | null | undefined) ?? null,
              clientName: (clientNameValue as string | null | undefined) ?? null,
              paymentTerms: (paymentTerms as string | null | undefined) ?? null,
              discount: (discountValue as number | null | undefined) ?? null,
              discountType: discountTypeValue ?? null,
              status: (status as string | null | undefined) ?? null,
              notes: (notes as string | null | undefined) ?? null,
            },
            tx,
          );
          if (!order) return { order: null, items: [] };

          let nextItems: clientsOrdersRepo.ClientOrderItem[];
          if (isSourceLinkedOrder) {
            nextItems = existingItems ?? (await clientsOrdersRepo.findItemsForOrder(order.id, tx));
          } else if (willReplaceItems && normalizedItems) {
            nextItems = await clientsOrdersRepo.replaceItems(
              order.id,
              buildItemsForInsert(normalizedItems),
              tx,
            );
          } else {
            nextItems = await clientsOrdersRepo.findItemsForOrder(order.id, tx);
          }
          return { order, items: nextItems };
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          if (error.constraint === 'sales_pkey' || error.detail?.includes('(id)')) {
            return reply.code(409).send({ error: 'Order ID already exists' });
          }
          if (
            error.constraint === 'idx_sales_linked_offer_id_unique' ||
            error.detail?.includes('(linked_offer_id)')
          ) {
            return reply.code(409).send({ error: 'A sale order already exists for this offer' });
          }
        }
        throw error;
      }

      const updatedOrder = result.order;
      const updatedItems = result.items;
      if (!updatedOrder) {
        return reply.code(404).send({ error: 'Order not found' });
      }

      const updatedOrderId = updatedOrder.id;

      const nextStatus = typeof status === 'string' ? status : updatedOrder.status;
      const didStatusChange = status !== undefined && existingOrder.status !== nextStatus;

      await logAudit({
        request,
        action: 'client_order.updated',
        entityType: 'client_order',
        entityId: updatedOrderId,
        details: {
          targetLabel: updatedOrderId,
          secondaryLabel: updatedOrder.clientName,
          fromValue: didStatusChange ? existingOrder.status : undefined,
          toValue: didStatusChange ? nextStatus : undefined,
        },
      });
      return { ...updatedOrder, items: updatedItems };
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

      const order = await clientsOrdersRepo.findStatusAndClientName(idResult.value);
      if (!order) {
        return reply.code(404).send({ error: 'Order not found' });
      }
      if (order.status !== 'draft') {
        return reply.code(409).send({
          error: 'Only draft clients_orders can be deleted',
          currentStatus: order.status,
        });
      }

      await clientsOrdersRepo.deleteById(idResult.value);

      await logAudit({
        request,
        action: 'client_order.deleted',
        entityType: 'client_order',
        entityId: idResult.value,
        details: {
          targetLabel: idResult.value,
          secondaryLabel: order.clientName ?? '',
        },
      });
      return reply.code(204).send();
    },
  );
}
