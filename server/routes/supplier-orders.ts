import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type DbExecutor, withDbTransaction } from '../db/drizzle.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as productsRepo from '../repositories/productsRepo.ts';
import * as supplierOrdersRepo from '../repositories/supplierOrdersRepo.ts';
import * as supplierOrderVersionsRepo from '../repositories/supplierOrderVersionsRepo.ts';
import * as supplierQuotesRepo from '../repositories/supplierQuotesRepo.ts';
import * as suppliersRepo from '../repositories/suppliersRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import {
  createDocumentDiscountConstraint,
  documentDiscountTypeSchema,
  documentDiscountValueSchema,
  updateDocumentDiscountConstraint,
} from '../schemas/documentDiscount.ts';
import {
  allocateDocumentCode,
  reserveDocumentCodeCounterFromCode,
} from '../services/documentCodes.ts';
import { logAudit } from '../utils/audit.ts';
import { getUniqueViolation } from '../utils/db-errors.ts';
import { replyDocumentCodeCollision } from '../utils/document-code-replies.ts';
import type { DurationUnit } from '../utils/duration-unit.ts';
import { generatePrefixedId, ITEM_ID_PREFIXES } from '../utils/order-ids.ts';
import { effectiveSupplierQuoteStatusFromDate } from '../utils/quote-status.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { replyError } from '../utils/replyError.ts';
import { normalizeUnitType, type UnitType } from '../utils/unit-type.ts';
import {
  badRequest,
  optionalDurationMonths,
  optionalDurationUnit,
  optionalEnum,
  optionalLocalizedDocumentDiscount,
  optionalLocalizedPercentage,
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
    unitType: { type: 'string', enum: ['hours', 'days', 'unit'] },
    unitPrice: { type: 'number' },
    note: { type: ['string', 'null'] },
    discount: { type: 'number' },
    durationMonths: { type: 'number' },
    durationUnit: { type: 'string', enum: ['months', 'years', 'na'] },
  },
  required: ['id', 'orderId', 'productName', 'quantity', 'unitType', 'unitPrice', 'discount'],
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
    unitType: { type: 'string', enum: ['hours', 'days', 'unit'] },
    unitPrice: { type: 'number' },
    discount: { type: 'number', minimum: 0, maximum: 100 },
    note: { type: 'string' },
    durationMonths: { type: 'number' },
    durationUnit: { type: 'string', enum: ['months', 'years', 'na'] },
  },
  required: ['productName', 'quantity', 'unitPrice'],
} as const;

const createBodySchema = {
  type: 'object',
  allOf: [createDocumentDiscountConstraint],
  properties: {
    id: { type: 'string' },
    linkedQuoteId: { type: 'string' },
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    items: { type: 'array', items: itemBodySchema },
    paymentTerms: { type: 'string' },
    discount: documentDiscountValueSchema,
    discountType: documentDiscountTypeSchema,
    status: { type: 'string', enum: ['draft', 'sent'] },
    notes: { type: 'string' },
  },
  required: ['linkedQuoteId', 'supplierId', 'supplierName', 'items'],
} as const;

const updateBodySchema = {
  type: 'object',
  allOf: [updateDocumentDiscountConstraint],
  properties: {
    id: { type: 'string' },
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    items: { type: 'array', items: itemBodySchema },
    paymentTerms: { type: 'string' },
    discount: documentDiscountValueSchema,
    discountType: documentDiscountTypeSchema,
    status: { type: 'string', enum: ['draft', 'sent'] },
    notes: { type: 'string' },
  },
} as const;

type SupplierOrderItemInput = {
  productId?: string;
  productName?: string;
  quantity?: string | number;
  unitType?: UnitType;
  unitPrice?: string | number;
  discount?: string | number;
  note?: string;
  durationMonths?: string | number;
  durationUnit?: DurationUnit;
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
    const discountResult = optionalLocalizedPercentage(item.discount, `items[${i}].discount`);
    if (!discountResult.ok) {
      badRequest(reply, discountResult.message);
      return null;
    }
    const unitType = normalizeUnitType(item.unitType);
    // Duration in months: a positive whole number, defaulting to 1 (one-off line). It remains a
    // plain multiplier for every quantity unit, matching supplier quotes.
    const durationMonthsResult = optionalDurationMonths(
      item.durationMonths,
      `items[${i}].durationMonths`,
    );
    if (!durationMonthsResult.ok) {
      badRequest(reply, durationMonthsResult.message);
      return null;
    }
    const durationUnitResult = optionalDurationUnit(item.durationUnit, `items[${i}].durationUnit`);
    if (!durationUnitResult.ok) {
      badRequest(reply, durationUnitResult.message);
      return null;
    }
    normalizedItems.push({
      id: generatePrefixedId(ITEM_ID_PREFIXES.supplierItem),
      productId: item.productId || null,
      productName: productNameResult.value,
      quantity: quantityResult.value,
      unitType,
      unitPrice: unitPriceResult.value,
      discount: discountResult.value || 0,
      note: item.note || null,
      durationMonths: durationMonthsResult.value ?? 1,
      durationUnit: durationUnitResult.value ?? 'months',
    });
  }
  return normalizedItems;
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.addHook('onRequest', authenticateToken);

  const snapshotPreState = async (
    orderId: string,
    reason: supplierOrderVersionsRepo.SupplierOrderVersionReason,
    request: FastifyRequest,
    tx: DbExecutor,
  ) => {
    const pre = await supplierOrdersRepo.findFullForSnapshot(orderId, tx);
    if (!pre) return;
    await supplierOrderVersionsRepo.insert(
      {
        orderId,
        snapshot: supplierOrderVersionsRepo.buildSnapshot(pre.order, pre.items),
        reason,
        createdByUserId: request.user?.id ?? null,
      },
      tx,
    );
  };

  const findMissingSnapshotReference = async (
    snapshot: supplierOrderVersionsRepo.SupplierOrderVersionSnapshot,
    exec: DbExecutor,
  ): Promise<string | null> => {
    const supplierExists = await suppliersRepo.existsById(snapshot.order.supplierId, exec);
    if (!supplierExists) {
      return `Snapshot supplier "${snapshot.order.supplierId}" no longer exists`;
    }

    const productIds = snapshot.items
      .map((item) => item.productId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (productIds.length === 0) return null;

    const products = await productsRepo.getSnapshots(productIds, exec);
    const missingProductId = productIds.find((id) => !products.has(id));
    return missingProductId ? `Snapshot product "${missingProductId}" no longer exists` : null;
  };

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
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Source quote not found',
          action: 'supplier_order.create.not_found',
          entityType: 'supplier_quote',
          entityId: linkedQuoteIdResult.value,
        });
      }
      // Effective accepted (issue #779): a supplier quote linked to an accepted client quote is
      // orderable even if its own stored status is still draft; `accepted` is frozen so its own
      // expiry never demotes it.
      const sourceEffective = effectiveSupplierQuoteStatusFromDate({
        expirationDate: sourceQuote.expirationDate,
        linkedClientStatus: sourceQuote.linkedClientQuoteStatus,
        linkedClientQuoteExpiration: sourceQuote.linkedClientQuoteExpiration,
        linkedOfferStatus: sourceQuote.linkedOfferStatus,
        linkedOfferExpiration: sourceQuote.linkedOfferExpiration,
      });
      if (sourceEffective !== 'accepted') {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Supplier orders can only be created from accepted quotes',
          action: 'supplier_order.create.conflict',
          entityType: 'supplier_quote',
          entityId: linkedQuoteIdResult.value,
          details: { secondaryLabel: 'source_quote_not_accepted', fromValue: sourceEffective },
        });
      }
      if (existingOrderId) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'A supplier order already exists for this quote',
          action: 'supplier_order.create.conflict',
          entityType: 'supplier_quote',
          entityId: linkedQuoteIdResult.value,
          details: { secondaryLabel: 'duplicate_order_for_quote' },
        });
      }
      if (
        supplierIdResult.value !== sourceQuote.supplierId ||
        supplierNameResult.value !== sourceQuote.supplierName
      ) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Supplier details must match the source quote',
          action: 'supplier_order.create.conflict',
          entityType: 'supplier_quote',
          entityId: linkedQuoteIdResult.value,
          details: { secondaryLabel: 'supplier_mismatch' },
        });
      }

      const discountTypeValue = discountType === 'currency' ? 'currency' : 'percentage';
      const discountResult = optionalLocalizedDocumentDiscount(
        discount,
        discountTypeValue,
        'discount',
      );
      if (!discountResult.ok) return badRequest(reply, discountResult.message);
      const statusResult = optionalEnum(status, SUPPLIER_ORDER_STATUSES, 'status');
      if (!statusResult.ok) return badRequest(reply, statusResult.message);
      const normalizedItems = normalizeItems(items, reply);
      if (!normalizedItems) return;

      type CreateOutcome =
        | { ok: false; status: number; body: Record<string, unknown> }
        | {
            ok: true;
            order: supplierOrdersRepo.SupplierOrder;
            items: supplierOrdersRepo.SupplierOrderItem[];
          };

      let result: CreateOutcome;
      try {
        result = await withDbTransaction(async (tx): Promise<CreateOutcome> => {
          // Lock the source supplier quote so a concurrent auto-create from a client order
          // (which also locks this row) serializes with this insert.
          const lockedQuote = await supplierQuotesRepo.lockEffectiveStatusById(
            linkedQuoteIdResult.value,
            tx,
          );
          if (!lockedQuote) {
            return { ok: false, status: 404, body: { error: 'Source quote not found' } };
          }
          const lockedEffective = effectiveSupplierQuoteStatusFromDate({
            expirationDate: lockedQuote.expirationDate,
            linkedClientStatus: lockedQuote.linkedClientStatus,
            linkedClientQuoteExpiration: lockedQuote.linkedClientQuoteExpiration,
            linkedOfferStatus: lockedQuote.linkedOfferStatus,
            linkedOfferExpiration: lockedQuote.linkedOfferExpiration,
          });
          if (lockedEffective !== 'accepted') {
            return {
              ok: false,
              status: 409,
              body: { error: 'Supplier orders can only be created from accepted quotes' },
            };
          }
          const existing = await supplierOrdersRepo.findExistingByLinkedQuote(
            linkedQuoteIdResult.value,
            tx,
          );
          if (existing) {
            return {
              ok: false,
              status: 409,
              body: { error: 'A supplier order already exists for this quote' },
            };
          }

          let orderId: string;
          if (nextIdResult.value) {
            await reserveDocumentCodeCounterFromCode('supplier_order', nextIdResult.value, tx);
            orderId = nextIdResult.value;
          } else {
            orderId = await allocateDocumentCode('supplier_order', {
              exec: tx,
              sourceCode: linkedQuoteIdResult.value,
            });
          }
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
          const createdItems = await supplierOrdersRepo.insertItems(order.id, normalizedItems, tx);
          return { ok: true, order, items: createdItems };
        });
      } catch (error) {
        const codeCollision = replyDocumentCodeCollision(
          request,
          reply,
          error,
          'supplier_order.create.conflict',
          'supplier_order',
        );
        if (codeCollision) return codeCollision;
        const dup = getUniqueViolation(error);
        if (dup) {
          if (dup.constraint === 'supplier_sales_pkey' || dup.detail?.includes('(id)')) {
            return replyError(request, reply, {
              statusCode: 409,
              message: 'Order ID already exists',
              action: 'supplier_order.create.conflict',
              entityType: 'supplier_order',
              details: { secondaryLabel: 'duplicate_id' },
            });
          }
          if (
            dup.constraint === 'idx_supplier_sales_linked_quote_id_unique' ||
            dup.detail?.includes('(linked_quote_id)')
          ) {
            return replyError(request, reply, {
              statusCode: 409,
              message: 'A supplier order already exists for this quote',
              action: 'supplier_order.create.conflict',
              entityType: 'supplier_quote',
              entityId: linkedQuoteIdResult.value,
              details: { secondaryLabel: 'duplicate_order_for_quote' },
            });
          }
        }
        throw error;
      }

      if (!result.ok) {
        return reply.code(result.status).send(result.body);
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
        supplierOrdersRepo.findExisting(idResult.value),
        nextIdValue
          ? supplierOrdersRepo.findIdConflict(nextIdValue, idResult.value)
          : Promise.resolve(false),
      ]);

      if (!existingOrder) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Order not found',
          action: 'supplier_order.update.not_found',
          entityType: 'supplier_order',
          entityId: idResult.value,
        });
      }
      if (idConflict) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Order ID already exists',
          action: 'supplier_order.update.conflict',
          entityType: 'supplier_order',
          entityId: idResult.value,
          details: { secondaryLabel: 'duplicate_id' },
        });
      }
      const hasLockedFieldUpdates =
        supplierId !== undefined ||
        supplierName !== undefined ||
        items !== undefined ||
        paymentTerms !== undefined ||
        discount !== undefined ||
        discountType !== undefined ||
        notes !== undefined;
      if (existingOrder.status !== 'draft' && hasLockedFieldUpdates) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Non-draft orders are read-only',
          action: 'supplier_order.update.conflict',
          entityType: 'supplier_order',
          entityId: idResult.value,
          details: { secondaryLabel: 'non_draft_read_only', fromValue: existingOrder.status },
          extraBody: { currentStatus: existingOrder.status },
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
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Quote-linked order supplier details are read-only',
            action: 'supplier_order.update.conflict',
            entityType: 'supplier_order',
            entityId: idResult.value,
            details: {
              targetLabel: idResult.value,
              secondaryLabel: 'quote_linked_locked_fields',
              changedFields: lockedFields,
            },
            extraBody: { fields: lockedFields },
          });
        }
      }

      const discountTypeValue =
        discountType === undefined
          ? undefined
          : discountType === 'currency'
            ? 'currency'
            : 'percentage';
      const effectiveDiscountType = discountTypeValue ?? existingOrder.discountType;
      const discountResult = optionalLocalizedDocumentDiscount(
        discount === undefined ? existingOrder.discount : discount,
        effectiveDiscountType,
        'discount',
      );
      if (!discountResult.ok) return badRequest(reply, discountResult.message);
      if (discount !== undefined && discountResult.value !== null) {
        patch.discount = discountResult.value;
      }
      if (discountTypeValue !== undefined) patch.discountType = discountTypeValue;

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

      const shouldSnapshot = hasLockedFieldUpdates || status !== undefined;

      let updated: supplierOrdersRepo.SupplierOrder | null;
      let resultItems: supplierOrdersRepo.SupplierOrderItem[];
      try {
        const txResult = await withDbTransaction(async (tx) => {
          if (shouldSnapshot) {
            await snapshotPreState(idResult.value, 'update', request, tx);
          }
          let renamedOrder: supplierOrdersRepo.SupplierOrder | null = null;
          if (nextIdValue && nextIdValue !== idResult.value) {
            renamedOrder = await supplierOrdersRepo.rename(idResult.value, nextIdValue, tx);
            if (!renamedOrder) {
              return { order: null, items: [] as supplierOrdersRepo.SupplierOrderItem[] };
            }
            await reserveDocumentCodeCounterFromCode('supplier_order', nextIdValue, tx);
          }
          // id-only renames have nothing left to write — reuse the row returned by rename().
          const order =
            Object.keys(patch).length === 0 && renamedOrder
              ? renamedOrder
              : await supplierOrdersRepo.update(renamedOrder?.id ?? idResult.value, patch, tx);
          if (!order) return { order: null, items: [] as supplierOrdersRepo.SupplierOrderItem[] };
          const finalItems = normalizedItems
            ? await supplierOrdersRepo.replaceItems(order.id, normalizedItems, tx)
            : await supplierOrdersRepo.findItemsForOrder(order.id, tx);
          return { order, items: finalItems };
        });
        updated = txResult.order;
        resultItems = txResult.items;
      } catch (error) {
        const dup = getUniqueViolation(error);
        if (dup && (dup.constraint === 'supplier_sales_pkey' || dup.detail?.includes('(id)'))) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Order ID already exists',
            action: 'supplier_order.update.conflict',
            entityType: 'supplier_order',
            entityId: idResult.value,
            details: { secondaryLabel: 'duplicate_id' },
          });
        }
        throw error;
      }

      if (!updated) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Order not found',
          action: 'supplier_order.update.not_found',
          entityType: 'supplier_order',
          entityId: idResult.value,
        });
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

  // ---------------------------------------------------------------------------------------
  // Version history
  // ---------------------------------------------------------------------------------------

  const versionParamSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      versionId: { type: 'string' },
    },
    required: ['id', 'versionId'],
  } as const;

  const orderVersionRowSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      orderId: { type: 'string' },
      reason: { type: 'string', enum: ['update', 'restore'] },
      createdByUserId: { type: ['string', 'null'] },
      createdAt: { type: 'number' },
    },
    required: ['id', 'orderId', 'reason', 'createdAt'],
  } as const;

  const orderVersionSchema = {
    type: 'object',
    properties: { ...orderVersionRowSchema.properties, snapshot: {} },
    required: [...orderVersionRowSchema.required, 'snapshot'],
  } as const;

  // GET /:id/versions - List versions for an order
  fastify.get(
    '/:id/versions',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('accounting.supplier_orders.view'),
      ],
      schema: {
        tags: ['supplier-orders'],
        summary: 'List versions for a supplier sale order',
        params: idParamSchema,
        response: {
          200: { type: 'array', items: orderVersionRowSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const [exists, versions] = await Promise.all([
        supplierOrdersRepo.existsById(idResult.value),
        supplierOrderVersionsRepo.listForOrder(idResult.value),
      ]);
      if (!exists) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Order not found',
          action: 'supplier_order.versions_list.not_found',
          entityType: 'supplier_order',
          entityId: idResult.value,
        });
      }
      return versions;
    },
  );

  // GET /:id/versions/:versionId - Get a single version with its snapshot
  fastify.get(
    '/:id/versions/:versionId',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('accounting.supplier_orders.view'),
      ],
      schema: {
        tags: ['supplier-orders'],
        summary: 'Get a single supplier sale order version',
        params: versionParamSchema,
        response: {
          200: orderVersionSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, versionId } = request.params as { id: string; versionId: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      const versionIdResult = requireNonEmptyString(versionId, 'versionId');
      if (!versionIdResult.ok) return badRequest(reply, versionIdResult.message);

      const version = await supplierOrderVersionsRepo.findById(
        idResult.value,
        versionIdResult.value,
      );
      if (!version) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Version not found',
          action: 'supplier_order.version_get.not_found',
          entityType: 'supplier_order',
          entityId: idResult.value,
          details: { secondaryLabel: versionIdResult.value },
        });
      }
      return version;
    },
  );

  // POST /:id/versions/:versionId/restore - Atomic restore (snapshots current first)
  fastify.post(
    '/:id/versions/:versionId/restore',
    {
      onRequest: [requirePermission('accounting.supplier_orders.update')],
      schema: {
        tags: ['supplier-orders'],
        summary: 'Restore a supplier sale order to a prior version',
        params: versionParamSchema,
        response: {
          200: orderSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, versionId } = request.params as { id: string; versionId: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      const versionIdResult = requireNonEmptyString(versionId, 'versionId');
      if (!versionIdResult.ok) return badRequest(reply, versionIdResult.message);

      type RestoreOutcome =
        | {
            ok: false;
            statusCode: 404 | 409;
            message: string;
            action: string;
            secondaryLabel?: string;
            fromValue?: string;
            extraBody?: Record<string, unknown>;
          }
        | {
            ok: true;
            order: supplierOrdersRepo.SupplierOrder;
            items: supplierOrdersRepo.SupplierOrderItem[];
          };

      // Run all gate reads inside the tx and lock the order row up front. The lock serializes
      // against the supplier-invoice create path (which locks this row before inserting an
      // invoice with linked_sale_id), closing the TOCTOU window between the linked-invoice
      // check and the restore write.
      const result: RestoreOutcome = await withDbTransaction(async (tx) => {
        const current = await supplierOrdersRepo.lockExistingById(idResult.value, tx);
        if (!current) {
          return {
            ok: false,
            statusCode: 404,
            message: 'Order not found',
            action: 'supplier_order.restore.not_found',
          };
        }
        if (current.status !== 'draft') {
          return {
            ok: false,
            statusCode: 409,
            message: 'Non-draft orders are read-only',
            action: 'supplier_order.restore.conflict',
            secondaryLabel: 'non_draft_read_only',
            fromValue: current.status,
            extraBody: { currentStatus: current.status },
          };
        }

        const [linkedInvoiceId, version] = await Promise.all([
          supplierOrdersRepo.findLinkedInvoiceId(idResult.value, tx),
          supplierOrderVersionsRepo.findById(idResult.value, versionIdResult.value, tx),
        ]);

        if (linkedInvoiceId) {
          return {
            ok: false,
            statusCode: 409,
            message: 'Cannot restore an order once an invoice has been created from it',
            action: 'supplier_order.restore.conflict',
            secondaryLabel: 'invoice_exists',
          };
        }
        if (!version) {
          return {
            ok: false,
            statusCode: 404,
            message: 'Version not found',
            action: 'supplier_order.restore.not_found',
            secondaryLabel: versionIdResult.value,
          };
        }
        const snapshotDiscountResult = optionalLocalizedDocumentDiscount(
          version.snapshot.order.discount,
          version.snapshot.order.discountType,
          'discount',
        );
        if (!snapshotDiscountResult.ok) {
          return {
            ok: false,
            statusCode: 409,
            message: `Snapshot has an invalid discount: ${snapshotDiscountResult.message}`,
            action: 'supplier_order.restore.conflict',
            secondaryLabel: 'snapshot_discount_invalid',
          };
        }
        const missingSnapshotReference = await findMissingSnapshotReference(version.snapshot, tx);
        if (missingSnapshotReference) {
          return {
            ok: false,
            statusCode: 409,
            message: missingSnapshotReference,
            action: 'supplier_order.restore.conflict',
            secondaryLabel: 'snapshot_reference_missing',
          };
        }

        const snapshotItems: supplierOrdersRepo.NewSupplierOrderItem[] = version.snapshot.items.map(
          ({ orderId: _o, ...rest }) => ({
            ...rest,
            id: generatePrefixedId(ITEM_ID_PREFIXES.supplierItem),
            // Empty-string productIds slip through some snapshots; the DB column needs NULL.
            productId: rest.productId || null,
            // Version snapshots created before quantity units were stored have no unitType.
            unitType: rest.unitType ?? 'hours',
            // Snapshots taken before duration existed (issue #776) lack these keys; default to a
            // single month so the restored line keeps its pre-duration total.
            durationMonths: rest.durationMonths ?? 1,
            durationUnit: rest.durationUnit ?? 'months',
          }),
        );

        await snapshotPreState(idResult.value, 'restore', request, tx);

        const order = await supplierOrdersRepo.restoreSnapshotOrder(
          idResult.value,
          {
            supplierId: version.snapshot.order.supplierId,
            supplierName: version.snapshot.order.supplierName,
            paymentTerms: version.snapshot.order.paymentTerms,
            discount: version.snapshot.order.discount,
            discountType: version.snapshot.order.discountType,
            status: version.snapshot.order.status,
            notes: version.snapshot.order.notes,
          },
          tx,
        );
        if (!order) {
          return {
            ok: false,
            statusCode: 404,
            message: 'Order not found',
            action: 'supplier_order.restore.not_found',
          };
        }
        const items = await supplierOrdersRepo.replaceItems(order.id, snapshotItems, tx);
        return { ok: true, order, items };
      });

      if (!result.ok) {
        return replyError(request, reply, {
          statusCode: result.statusCode,
          message: result.message,
          action: result.action,
          entityType: 'supplier_order',
          entityId: idResult.value,
          details: { secondaryLabel: result.secondaryLabel, fromValue: result.fromValue },
          extraBody: result.extraBody,
        });
      }
      const restored = { order: result.order, items: result.items };

      await logAudit({
        request,
        action: 'supplier_order.restored',
        entityType: 'supplier_order',
        entityId: restored.order.id,
        details: {
          targetLabel: restored.order.id,
          secondaryLabel: restored.order.supplierName,
          toValue: versionIdResult.value,
        },
      });

      return {
        ...restored.order,
        items: restored.items,
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
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Cannot delete an order once an invoice has been created from it',
          action: 'supplier_order.delete.conflict',
          entityType: 'supplier_order',
          entityId: idResult.value,
          details: { secondaryLabel: 'invoice_exists' },
        });
      }
      if (!existing) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Order not found',
          action: 'supplier_order.delete.not_found',
          entityType: 'supplier_order',
          entityId: idResult.value,
        });
      }
      if (existing.status !== 'draft') {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Only draft orders can be deleted',
          action: 'supplier_order.delete.conflict',
          entityType: 'supplier_order',
          entityId: idResult.value,
          details: { secondaryLabel: 'non_draft_status', fromValue: existing.status },
        });
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
