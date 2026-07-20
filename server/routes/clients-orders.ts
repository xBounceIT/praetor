import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type DbExecutor, withDbTransaction } from '../db/drizzle.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as clientOffersRepo from '../repositories/clientOffersRepo.ts';
import * as clientsOrdersRepo from '../repositories/clientsOrdersRepo.ts';
import * as clientsRepo from '../repositories/clientsRepo.ts';
import * as orderVersionsRepo from '../repositories/orderVersionsRepo.ts';
import * as productsRepo from '../repositories/productsRepo.ts';
import * as supplierQuotesRepo from '../repositories/supplierQuotesRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import {
  createDocumentDiscountConstraint,
  documentDiscountTypeSchema,
  documentDiscountValueSchema,
} from '../schemas/documentDiscount.ts';
import {
  autoCreateSupplierOrdersForClientOrder,
  createClientOrderRows,
  logClientOrderCreated,
} from '../services/clientOrderCreation.ts';
import { reserveDocumentCodeCounterFromCode } from '../services/documentCodes.ts';
import { logAudit } from '../utils/audit.ts';
import { withCalculatedClientLineMol } from '../utils/client-line-pricing.ts';
import { getForeignKeyViolation, getUniqueViolation } from '../utils/db-errors.ts';
import { replyDocumentCodeCollision } from '../utils/document-code-replies.ts';
import type { DurationUnit } from '../utils/duration-unit.ts';
import { normalizeNullableNumber, normalizeNullableString } from '../utils/normalize.ts';
import { generatePrefixedId, ITEM_ID_PREFIXES } from '../utils/order-ids.ts';
import { requestHasPermission } from '../utils/permissions.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { replyError } from '../utils/replyError.ts';
import { normalizeUnitType, type UnitType } from '../utils/unit-type.ts';
import {
  badRequest,
  optionalDurationMonths,
  optionalDurationUnit,
  optionalLocalizedDocumentDiscount,
  optionalLocalizedPercentage,
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
    supplierQuoteRevisionCode: { type: ['string', 'null'] },
    supplierQuoteItemId: { type: ['string', 'null'] },
    supplierQuoteSupplierName: { type: ['string', 'null'] },
    supplierQuoteUnitPrice: { type: ['number', 'null'] },
    supplierSaleId: { type: ['string', 'null'] },
    supplierSaleItemId: { type: ['string', 'null'] },
    supplierSaleSupplierName: { type: ['string', 'null'] },
    unitType: { type: 'string', enum: ['hours', 'days', 'unit'] },
    note: { type: ['string', 'null'] },
    discount: { type: 'number', minimum: 0, maximum: 100 },
    durationMonths: { type: 'number' },
    durationUnit: { type: 'string', enum: ['months', 'years', 'na'] },
  },
  required: ['id', 'orderId', 'productName', 'quantity', 'unitPrice', 'productCost', 'discount'],
} as const;

const clientOrderSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    linkedQuoteId: { type: ['string', 'null'] },
    linkedQuoteRevisionCode: { type: ['string', 'null'] },
    linkedOfferId: { type: ['string', 'null'] },
    linkedOfferRevisionCode: { type: ['string', 'null'] },
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
    supplierOrders: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          supplierQuoteId: { type: 'string' },
          supplierName: { type: 'string' },
        },
        required: ['id', 'supplierQuoteId', 'supplierName'],
      },
    },
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
    // Nullable / optional: a supplier-quote-sourced line carries `supplierQuoteItemId` instead
    // of a catalog product id (issue #783). `normalizeIncomingItems` enforces that one of the
    // two is present.
    productId: { type: ['string', 'null'] },
    productName: { type: 'string' },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    productCost: { type: 'number' },
    // Nullable to match the response schema (clientOrderItemSchema): the offer→order conversion
    // spreads `clientOffersRepo.mapItem` output verbatim, so these arrive as explicit `null` for
    // non-product / non-supplier lines. Declaring them nullable (instead of relying on Ajv's
    // coerceTypes to turn null→''/0) keeps the null "unset" semantic through normalizeIncomingItems.
    productMolPercentage: { type: ['number', 'null'] },
    supplierQuoteId: {
      type: ['string', 'null'],
      description:
        'Supplier quote id snapshot. The server derives this from supplierQuoteItemId and clears an id supplied without an item reference.',
    },
    supplierQuoteItemId: {
      type: ['string', 'null'],
      description:
        'Supplier quote item source. Without accounting.supplier_orders.create, creates require the accepted same-client source offer and may use each item only as many times as that offer does; updates may only retain references already stored on the order. Retained updates preserve stored supplier metadata. Version restore revalidates the live item and refreshes its supplier metadata.',
    },
    supplierQuoteSupplierName: { type: ['string', 'null'] },
    supplierQuoteUnitPrice: { type: ['number', 'null'] },
    supplierSaleId: { type: ['string', 'null'] },
    supplierSaleItemId: { type: ['string', 'null'] },
    supplierSaleSupplierName: { type: ['string', 'null'] },
    unitType: { type: 'string', enum: ['hours', 'days', 'unit'] },
    discount: { type: 'number', minimum: 0, maximum: 100 },
    note: { type: ['string', 'null'] },
    durationMonths: { type: 'number' },
    durationUnit: { type: 'string', enum: ['months', 'years', 'na'] },
  },
  // productId is intentionally NOT required so free-form supplier-quote lines (no linked product)
  // can be converted into orders (#783/#795). unitType is likewise optional here — product-less
  // lines may omit it and the route defaults it via normalizeUnitType.
  required: ['productName', 'quantity', 'unitPrice'],
} as const;

const clientOrderCreateBodySchema = {
  type: 'object',
  allOf: [createDocumentDiscountConstraint],
  properties: {
    id: { type: 'string' },
    linkedQuoteId: { type: 'string' },
    linkedOfferId: { type: 'string' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    items: { type: 'array', items: clientOrderItemBodySchema },
    paymentTerms: { type: 'string' },
    discount: documentDiscountValueSchema,
    discountType: documentDiscountTypeSchema,
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
    discount: documentDiscountValueSchema,
    discountType: documentDiscountTypeSchema,
    status: { type: 'string' },
    notes: { type: ['string', 'null'] },
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
  durationMonths: number;
  durationUnit: DurationUnit;
};

const normalizeIncomingItems = (
  items: unknown[],
  reply: FastifyReply,
): NormalizedOrderItem[] | null => {
  const normalized: NormalizedOrderItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as Record<string, unknown>;
    // A line is either pinned to a catalog product (`productId`) or sourced from a supplier-quote
    // item (`supplierQuoteItemId`). Require one of the two. A product-less line needs only the item
    // reference: `resolveSupplierQuoteRefs` (run after this) resolves it against accepted supplier
    // quotes, rejects unresolvable/non-accepted refs, and stamps the authoritative `supplierQuoteId`.
    // So clients (and older payloads) don't have to duplicate the quote id — matching the
    // client-quotes item-only reference pattern, while still avoiding dangling lines (issue #783).
    const supplierQuoteId = normalizeNullableString(item.supplierQuoteId);
    const supplierQuoteItemId = normalizeNullableString(item.supplierQuoteItemId);
    const productId = normalizeNullableString(item.productId);
    if (!productId && !supplierQuoteItemId) {
      badRequest(
        reply,
        `items[${i}].productId is required unless the line references a supplier-quote item (supplierQuoteItemId)`,
      );
      return null;
    }
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
    const itemDiscountResult = optionalLocalizedPercentage(item.discount, `items[${i}].discount`);
    if (!itemDiscountResult.ok) {
      badRequest(reply, itemDiscountResult.message);
      return null;
    }
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
    const unitType = normalizeUnitType(item.unitType);
    const durationMonths = durationMonthsResult.value ?? 1;
    const durationUnit = durationUnitResult.value ?? 'months';
    normalized.push({
      id: typeof item.id === 'string' ? item.id : undefined,
      productId,
      productName: productNameResult.value,
      quantity: quantityResult.value,
      unitPrice: unitPriceResult.value,
      productCost: Number(item.productCost ?? 0),
      productMolPercentage: normalizeNullableNumber(item.productMolPercentage),
      // A quote id without its item reference is not an authoritative sourcing relationship.
      // Clear all quote metadata in that case so a raw client cannot manufacture one.
      supplierQuoteId: supplierQuoteItemId ? supplierQuoteId : null,
      supplierQuoteItemId,
      supplierQuoteSupplierName: supplierQuoteItemId
        ? normalizeNullableString(item.supplierQuoteSupplierName)
        : null,
      supplierQuoteUnitPrice: supplierQuoteItemId
        ? normalizeNullableNumber(item.supplierQuoteUnitPrice)
        : null,
      supplierSaleId: normalizeNullableString(item.supplierSaleId),
      supplierSaleItemId: normalizeNullableString(item.supplierSaleItemId),
      supplierSaleSupplierName: normalizeNullableString(item.supplierSaleSupplierName),
      unitType,
      note: normalizeNullableString(item.note),
      discount: itemDiscountResult.value || 0,
      durationMonths,
      durationUnit,
    });
  }
  return normalized;
};

type SupplierQuoteResolutionOptions = {
  allowedSupplierQuoteItemCounts?: ReadonlyMap<string, number>;
  retainedSupplierItemsByLineId?: ReadonlyMap<string, clientsOrdersRepo.ClientOrderItem>;
};

// `sale_items.supplier_quote_*` has no FK, so resolve every fresh supplier item against the live
// quote item. Exact retained update refs instead reuse the order's stored sourcing snapshot: an
// unrelated edit must not rewrite historical cost because the supplier quote changed later.
const resolveSupplierQuoteRefs = async (
  items: NormalizedOrderItem[],
  reply: FastifyReply,
  options: SupplierQuoteResolutionOptions = {},
): Promise<NormalizedOrderItem[] | null> => {
  const lineIdCounts = new Map<string, number>();
  for (const item of items) {
    if (item.id) lineIdCounts.set(item.id, (lineIdCounts.get(item.id) ?? 0) + 1);
  }
  const retainedSupplierItemFor = (item: NormalizedOrderItem) => {
    const retained =
      item.id && lineIdCounts.get(item.id) === 1
        ? options.retainedSupplierItemsByLineId?.get(item.id)
        : undefined;
    return retained?.supplierQuoteItemId === item.supplierQuoteItemId ? retained : undefined;
  };
  const referencedItemIds = items.flatMap((item) =>
    item.supplierQuoteItemId && !retainedSupplierItemFor(item) ? [item.supplierQuoteItemId] : [],
  );

  const usedSupplierQuoteItemCounts = new Map<string, number>();
  const forbiddenIndex = items.findIndex((item) => {
    if (
      !item.supplierQuoteItemId ||
      retainedSupplierItemFor(item) ||
      options.allowedSupplierQuoteItemCounts === undefined
    ) {
      return false;
    }
    const usedCount = (usedSupplierQuoteItemCounts.get(item.supplierQuoteItemId) ?? 0) + 1;
    usedSupplierQuoteItemCounts.set(item.supplierQuoteItemId, usedCount);
    return usedCount > (options.allowedSupplierQuoteItemCounts.get(item.supplierQuoteItemId) ?? 0);
  });
  if (forbiddenIndex >= 0) {
    reply.code(403).send({
      error: `items[${forbiddenIndex}].supplierQuoteItemId requires an accepted source offer or accounting.supplier_orders.create permission`,
    });
    return null;
  }

  const snapshots =
    referencedItemIds.length > 0
      ? await supplierQuotesRepo.getQuoteItemSnapshots(referencedItemIds)
      : new Map<string, supplierQuotesRepo.QuoteItemSnapshot>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.supplierQuoteItemId) continue;
    const retained = retainedSupplierItemFor(item);
    if (retained) {
      items[i] = {
        ...item,
        productId: retained.productId,
        supplierQuoteId: retained.supplierQuoteId,
        supplierQuoteSupplierName: retained.supplierQuoteSupplierName,
        supplierQuoteUnitPrice: retained.supplierQuoteUnitPrice,
      };
      continue;
    }
    const snapshot = snapshots.get(item.supplierQuoteItemId);
    if (!snapshot) {
      badRequest(
        reply,
        `items[${i}].supplierQuoteItemId "${item.supplierQuoteItemId}" does not reference an existing supplier quote item`,
      );
      return null;
    }
    // Trust the snapshot, not the client: stamp the authoritative quote id, supplier name and unit
    // price. A catalog-backed supplier-quote item also carries a real productId — adopt it so the
    // sale stays visible to product quick-links and catalog usage/revenue reports.
    items[i] = {
      ...item,
      productId: snapshot.productId,
      supplierQuoteId: snapshot.supplierQuoteId,
      supplierQuoteSupplierName: snapshot.supplierName,
      supplierQuoteUnitPrice: snapshot.netCost,
    };
  }
  return items.map(withCalculatedClientLineMol);
};

const buildItemsForInsert = (
  items: NormalizedOrderItem[],
): clientsOrdersRepo.NewClientOrderItem[] =>
  items.map((item) => ({
    id: generatePrefixedId(ITEM_ID_PREFIXES.saleItem),
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
    durationMonths: item.durationMonths,
    durationUnit: item.durationUnit,
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

// Fingerprint covers every user-authored field that flows into the JSONB snapshot. MOL is omitted
// because it is derived from cost + unitPrice; either source changing already flips the flag, while
// an old stale/null MOL must not turn an otherwise no-op save into a new version.
const snapshotItemFingerprint = (item: {
  id?: string | null;
  productId?: string | null;
  productName?: string | null;
  quantity: number | string;
  unitPrice: number | string;
  productCost: number | string;
  productMolPercentage: number | null;
  discount: number | string | null;
  note?: string | null;
  unitType: string;
  supplierQuoteId?: string | null;
  supplierQuoteItemId?: string | null;
  supplierQuoteSupplierName?: string | null;
  supplierQuoteUnitPrice: number | string | null;
  supplierSaleId?: string | null;
  supplierSaleItemId?: string | null;
  supplierSaleSupplierName?: string | null;
  durationMonths?: number | null;
  durationUnit?: string | null;
}) =>
  [
    item.id ?? '',
    item.productId ?? '',
    item.productName ?? '',
    Number(item.quantity),
    Number(item.unitPrice),
    Number(item.productCost),
    item.discount == null ? 0 : Number(item.discount),
    normalizeNotesValue(item.note),
    item.unitType,
    item.supplierQuoteId ?? '',
    item.supplierQuoteItemId ?? '',
    item.supplierQuoteSupplierName ?? '',
    item.supplierQuoteUnitPrice == null ? '' : Number(item.supplierQuoteUnitPrice),
    item.supplierSaleId ?? '',
    item.supplierSaleItemId ?? '',
    item.supplierSaleSupplierName ?? '',
    item.durationMonths == null ? 1 : Number(item.durationMonths),
    item.durationUnit ?? 'months',
  ].join('|');

const itemsChangedForSnapshot = (
  existing: Array<Parameters<typeof snapshotItemFingerprint>[0]>,
  incoming: Array<Parameters<typeof snapshotItemFingerprint>[0]>,
): boolean => {
  if (existing.length !== incoming.length) return true;
  const a = existing.map(snapshotItemFingerprint).sort();
  const b = incoming.map(snapshotItemFingerprint).sort();
  return a.some((fp, i) => fp !== b[i]);
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.addHook('onRequest', authenticateToken);
  // API path is clients-orders for backward compatibility; data is stored in sales/sale_items.

  const snapshotPreState = async (
    orderId: string,
    reason: orderVersionsRepo.OrderVersionReason,
    request: FastifyRequest,
    tx: DbExecutor,
  ) => {
    const pre = await clientsOrdersRepo.findFullForSnapshot(orderId, tx);
    if (!pre) return;
    await orderVersionsRepo.insert(
      {
        orderId,
        snapshot: orderVersionsRepo.buildSnapshot(pre.order, pre.items),
        reason,
        createdByUserId: request.user?.id ?? null,
      },
      tx,
    );
  };

  const validateSnapshotReferences = async (
    snapshot: orderVersionsRepo.OrderVersionSnapshot,
  ): Promise<{
    error: string | null;
    supplierQuoteItems: Map<string, supplierQuotesRepo.QuoteItemSnapshot>;
  }> => {
    // Supplier-backed lines adopt the live supplier item's product below, so only validate a
    // snapshot product id when that product is the one restore will actually persist.
    const productIds = Array.from(
      new Set(
        snapshot.items
          .filter((item) => !normalizeNullableString(item.supplierQuoteItemId))
          .map((item) => item.productId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    );
    const supplierReferencedItems = snapshot.items.filter((item) =>
      normalizeNullableString(item.supplierQuoteItemId),
    );
    const supplierQuoteItemIds = supplierReferencedItems
      .map((item) => normalizeNullableString(item.supplierQuoteItemId))
      .filter((id): id is string => id !== null);
    const [clientExists, products, supplierQuoteItems] = await Promise.all([
      clientsRepo.existsById(snapshot.order.clientId),
      productIds.length > 0 ? productsRepo.getSnapshots(productIds) : Promise.resolve(new Map()),
      supplierQuoteItemIds.length > 0
        ? supplierQuotesRepo.getQuoteItemSnapshots(supplierQuoteItemIds)
        : Promise.resolve(new Map<string, supplierQuotesRepo.QuoteItemSnapshot>()),
    ]);
    if (!clientExists) {
      return {
        error: `Snapshot client "${snapshot.order.clientId}" no longer exists`,
        supplierQuoteItems,
      };
    }
    const missingProductId = productIds.find((id) => !products.has(id));
    if (missingProductId) {
      return {
        error: `Snapshot product "${missingProductId}" no longer exists`,
        supplierQuoteItems,
      };
    }
    // A product-less snapshot item needs a supplier-quote item as its alternative source anchor.
    // Every supplier-quote item reference, including on product-backed lines, must still resolve
    // so restore cannot reintroduce a dead or client-controlled relationship that POST/PUT reject.
    const productlessItems = snapshot.items.filter(
      (item) => !normalizeNullableString(item.productId),
    );
    const orphanedItem = productlessItems.find(
      (item) => !normalizeNullableString(item.supplierQuoteItemId),
    );
    if (orphanedItem) {
      return {
        error: `Snapshot item "${orphanedItem.productName}" has no catalog product and no supplier-quote reference`,
        supplierQuoteItems,
      };
    }
    const staleItem = supplierReferencedItems.find((item) => {
      const itemId = normalizeNullableString(item.supplierQuoteItemId);
      return itemId !== null && !supplierQuoteItems.has(itemId);
    });
    if (staleItem) {
      return {
        error: `Snapshot item "${staleItem.productName}" references a supplier quote item that no longer exists`,
        supplierQuoteItems,
      };
    }
    return { error: null, supplierQuoteItems };
  };

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

      const parsedItems = normalizeIncomingItems(items, reply);
      if (!parsedItems) return;

      const discountTypeValue = discountType === 'currency' ? 'currency' : 'percentage';
      const discountResult = optionalLocalizedDocumentDiscount(
        discount,
        discountTypeValue,
        'discount',
      );
      if (!discountResult.ok) return badRequest(reply, discountResult.message);

      const canCreateSupplierOrders = requestHasPermission(
        request,
        'accounting.supplier_orders.create',
      );
      let linkedQuoteIdValue = linkedQuoteIdResult.value;
      const sourceOfferSupplierQuoteItemCounts = new Map<string, number>();
      if (linkedOfferIdResult.value) {
        const offer = await clientsOrdersRepo.findOfferDetails(linkedOfferIdResult.value);
        if (!offer) {
          return replyError(request, reply, {
            statusCode: 404,
            message: 'Source offer not found',
            action: 'client_order.create.not_found',
            entityType: 'client_offer',
            entityId: linkedOfferIdResult.value,
          });
        }
        if (offer.status !== 'accepted') {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Sale orders can only be created from accepted offers',
            action: 'client_order.create.conflict',
            entityType: 'client_offer',
            entityId: linkedOfferIdResult.value,
            details: { secondaryLabel: 'source_offer_not_accepted', fromValue: offer.status },
          });
        }
        if (offer.clientId !== clientIdResult.value) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'clientId must match the source offer client',
            action: 'client_order.create.conflict',
            entityType: 'client_offer',
            entityId: linkedOfferIdResult.value,
            details: { secondaryLabel: 'client_mismatch' },
          });
        }

        if (await clientsOrdersRepo.findExistingForOffer(linkedOfferIdResult.value)) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'A sale order already exists for this offer',
            action: 'client_order.create.conflict',
            entityType: 'client_offer',
            entityId: linkedOfferIdResult.value,
            details: { secondaryLabel: 'duplicate_order_for_offer' },
          });
        }

        if (
          linkedQuoteIdResult.value !== null &&
          linkedQuoteIdResult.value !== offer.linkedQuoteId
        ) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'linkedQuoteId must match the source offer quote',
            action: 'client_order.create.conflict',
            entityType: 'client_offer',
            entityId: linkedOfferIdResult.value,
            details: { secondaryLabel: 'quote_mismatch' },
          });
        }

        linkedQuoteIdValue = offer.linkedQuoteId || null;
        if (!canCreateSupplierOrders) {
          const sourceOfferItems = await clientOffersRepo.findItemsForOffer(
            linkedOfferIdResult.value,
          );
          for (const item of sourceOfferItems) {
            if (!item.supplierQuoteItemId) continue;
            sourceOfferSupplierQuoteItemCounts.set(
              item.supplierQuoteItemId,
              (sourceOfferSupplierQuoteItemCounts.get(item.supplierQuoteItemId) ?? 0) + 1,
            );
          }
        }
      }

      const normalizedItems = await resolveSupplierQuoteRefs(parsedItems, reply, {
        allowedSupplierQuoteItemCounts: canCreateSupplierOrders
          ? undefined
          : sourceOfferSupplierQuoteItemCounts,
      });
      if (!normalizedItems) return;
      const trustedSupplierQuoteItemIds = new Set(
        normalizedItems.flatMap((item) =>
          item.supplierQuoteItemId ? [item.supplierQuoteItemId] : [],
        ),
      );

      type CreateOutcome =
        | { ok: false; status: number; body: Record<string, unknown> }
        | {
            ok: true;
            order: clientsOrdersRepo.ClientOrder;
            items: clientsOrdersRepo.ClientOrderItem[];
          };

      let createdOrder: clientsOrdersRepo.ClientOrder;
      let insertedItems: clientsOrdersRepo.ClientOrderItem[];
      try {
        const result = await withDbTransaction(async (tx): Promise<CreateOutcome> => {
          // Lock the source offer so a concurrent offer-restore (which gates on
          // "no linked sale exists") serializes against this insert.
          if (linkedOfferIdResult.value) {
            const lockedOffer = await clientOffersRepo.lockExistingById(
              linkedOfferIdResult.value,
              tx,
            );
            if (!lockedOffer) {
              return { ok: false, status: 404, body: { error: 'Source offer not found' } };
            }
            if (lockedOffer.status !== 'accepted') {
              return {
                ok: false,
                status: 409,
                body: { error: 'Sale orders can only be created from accepted offers' },
              };
            }
            const existing = await clientsOrdersRepo.findExistingForOffer(
              linkedOfferIdResult.value,
              null,
              tx,
            );
            if (existing) {
              return {
                ok: false,
                status: 409,
                body: { error: 'A sale order already exists for this offer' },
              };
            }
          }

          const { order, items } = await createClientOrderRows(
            {
              id: nextIdResult.value,
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
            buildItemsForInsert(normalizedItems),
            tx,
          );
          return { ok: true, order, items };
        });
        if (!result.ok) {
          return reply.code(result.status).send(result.body);
        }
        createdOrder = result.order;
        insertedItems = result.items;
      } catch (error) {
        const codeCollision = replyDocumentCodeCollision(
          request,
          reply,
          error,
          'client_order.create.conflict',
          'client_order',
        );
        if (codeCollision) return codeCollision;
        const dup = getUniqueViolation(error);
        if (dup) {
          if (dup.constraint === 'sales_pkey' || dup.detail?.includes('(id)')) {
            return replyError(request, reply, {
              statusCode: 409,
              message: 'Order ID already exists',
              action: 'client_order.create.conflict',
              entityType: 'client_order',
              details: { secondaryLabel: 'duplicate_id' },
            });
          }
          if (
            dup.constraint === 'idx_sales_linked_offer_id_unique' ||
            dup.detail?.includes('(linked_offer_id)')
          ) {
            return replyError(request, reply, {
              statusCode: 409,
              message: 'A sale order already exists for this offer',
              action: 'client_order.create.conflict',
              entityType: 'client_offer',
              entityId: linkedOfferIdResult.value ?? undefined,
              details: { secondaryLabel: 'duplicate_order_for_offer' },
            });
          }
        }
        throw error;
      }

      const supplierOrderResult = await autoCreateSupplierOrdersForClientOrder(
        request,
        createdOrder,
        insertedItems,
        trustedSupplierQuoteItemIds,
        withDbTransaction,
      );

      await logClientOrderCreated(request, createdOrder);
      return reply.code(201).send({
        ...createdOrder,
        items: supplierOrderResult.items,
        ...(supplierOrderResult.supplierOrders.length > 0
          ? { supplierOrders: supplierOrderResult.supplierOrders }
          : {}),
        ...(supplierOrderResult.warnings.length > 0
          ? { warnings: supplierOrderResult.warnings }
          : {}),
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
            return replyError(request, reply, {
              statusCode: 409,
              message: 'Order ID already exists',
              action: 'client_order.update.conflict',
              entityType: 'client_order',
              entityId: idResult.value,
              details: { secondaryLabel: 'duplicate_id', toValue: nextIdResult.value },
            });
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

      let parsedItemsForUpdate: NormalizedOrderItem[] | null = null;
      if (items !== undefined) {
        if (!Array.isArray(items) || items.length === 0) {
          return badRequest(reply, 'Items must be a non-empty array');
        }
        parsedItemsForUpdate = normalizeIncomingItems(items, reply);
        if (!parsedItemsForUpdate) return;
      }

      const existingOrder = await clientsOrdersRepo.findExisting(idResult.value);
      if (!existingOrder) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Order not found',
          action: 'client_order.update.not_found',
          entityType: 'client_order',
          entityId: idResult.value,
        });
      }

      const effectiveDiscountType = discountTypeValue ?? existingOrder.discountType;
      const discountPairChanged =
        (discount !== undefined && discount !== existingOrder.discount) ||
        (discountTypeValue !== undefined && discountTypeValue !== existingOrder.discountType);
      let discountValue: number | null | undefined;
      if (discountPairChanged) {
        const discountResult = optionalLocalizedDocumentDiscount(
          discount === undefined ? existingOrder.discount : discount,
          effectiveDiscountType,
          'discount',
        );
        if (!discountResult.ok) return badRequest(reply, discountResult.message);
        discountValue = discount === undefined ? undefined : discountResult.value;
      }

      const requestedOrderIdChanged = nextIdValue !== null && nextIdValue !== idResult.value;
      const hasLockedFieldUpdates =
        linkedOfferId !== undefined ||
        clientIdValue !== undefined ||
        clientNameValue !== undefined ||
        paymentTerms !== undefined ||
        discountValue !== undefined ||
        discountType !== undefined ||
        notes !== undefined ||
        items !== undefined;

      if (existingOrder.status === 'denied' && (requestedOrderIdChanged || hasLockedFieldUpdates)) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Denied clients_orders are read-only',
          action: 'client_order.update.conflict',
          entityType: 'client_order',
          entityId: idResult.value,
          details: { secondaryLabel: 'denied_read_only', fromValue: existingOrder.status },
          extraBody: { currentStatus: existingOrder.status },
        });
      }

      if (existingOrder.status === 'confirmed') {
        const identityLockedFields: string[] = [];
        if (requestedOrderIdChanged) identityLockedFields.push('id');
        if (
          linkedOfferIdValue !== undefined &&
          (linkedOfferIdValue ?? null) !== (existingOrder.linkedOfferId ?? null)
        ) {
          identityLockedFields.push('linkedOfferId');
        }
        if (clientIdValue !== undefined && clientIdValue !== existingOrder.clientId) {
          identityLockedFields.push('clientId');
        }
        if (clientNameValue !== undefined && clientNameValue !== existingOrder.clientName) {
          identityLockedFields.push('clientName');
        }

        if (identityLockedFields.length > 0) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Confirmed client order identity fields are read-only',
            action: 'client_order.update.conflict',
            entityType: 'client_order',
            entityId: idResult.value,
            details: {
              secondaryLabel: 'confirmed_identity_locked_fields',
              changedFields: identityLockedFields,
            },
            extraBody: { fields: identityLockedFields, currentStatus: existingOrder.status },
          });
        }
      }

      let existingItems: clientsOrdersRepo.ClientOrderItem[] | null = null;
      let normalizedItems: NormalizedOrderItem[] | null = null;
      if (parsedItemsForUpdate) {
        const canCreateSupplierOrders = requestHasPermission(
          request,
          'accounting.supplier_orders.create',
        );
        const hasSupplierQuoteRefs = parsedItemsForUpdate.some(
          (item) => item.supplierQuoteItemId !== null,
        );
        let retainedSupplierItemsByLineId:
          | ReadonlyMap<string, clientsOrdersRepo.ClientOrderItem>
          | undefined;
        if (hasSupplierQuoteRefs) {
          existingItems = await clientsOrdersRepo.findItemsForOrder(idResult.value);
          retainedSupplierItemsByLineId = new Map(
            existingItems.map((item) => [item.id, item] as const),
          );
        }
        normalizedItems = await resolveSupplierQuoteRefs(parsedItemsForUpdate, reply, {
          allowedSupplierQuoteItemCounts: canCreateSupplierOrders ? undefined : new Map(),
          retainedSupplierItemsByLineId,
        });
        if (!normalizedItems) return;
      }

      const nextLinkedOfferId =
        typeof linkedOfferIdValue === 'string' && linkedOfferIdValue !== existingOrder.linkedOfferId
          ? linkedOfferIdValue
          : null;
      const isSourceLinkedOrder = Boolean(
        existingOrder.linkedQuoteId || existingOrder.linkedOfferId,
      );
      // Draft and confirmed orders created from an offer/quote are live downstream documents.
      // Confirmed orders keep identity fields locked above, while commercial fields and guarded
      // line edits still flow through this source-linked path.
      const allowSourceLinkedEdit =
        existingOrder.status === 'draft' || existingOrder.status === 'confirmed';

      if (isSourceLinkedOrder && !allowSourceLinkedEdit) {
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
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Quote-linked order details are read-only',
            action: 'client_order.update.conflict',
            entityType: 'client_order',
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

      // A draft order created from an offer can include lines whose accepted supplier quotes
      // auto-created supplier (procurement) orders at create time (supplierSaleId /
      // supplierSaleItemId are recorded on the sale item). clientsOrdersRepo.replaceItems
      // deletes+reinserts sale_items without reconciling those supplier orders, so dropping such a
      // line — or changing its product/quantity — would leave procurement pointing at stale data.
      // Keep the supplier-order-backed lines locked; header fields, sale-side fields (price /
      // discount / note), other lines and additions all stay editable.
      if (isSourceLinkedOrder && allowSourceLinkedEdit && items !== undefined) {
        if (existingItems === null) {
          existingItems = await clientsOrdersRepo.findItemsForOrder(idResult.value);
        }
        const supplierBackedItems = existingItems.filter((it) => it.supplierSaleItemId);
        if (supplierBackedItems.length > 0) {
          const incomingBySupplierItemId = new Map(
            (normalizedItems ?? []).flatMap((it) =>
              it.supplierSaleItemId ? [[it.supplierSaleItemId as string, it] as const] : [],
            ),
          );
          const desyncsSupplierOrder = supplierBackedItems.some((existing) => {
            const incoming = incomingBySupplierItemId.get(existing.supplierSaleItemId as string);
            return (
              !incoming ||
              incoming.productId !== existing.productId ||
              Number(incoming.quantity) !== Number(existing.quantity)
            );
          });
          if (desyncsSupplierOrder) {
            return replyError(request, reply, {
              statusCode: 409,
              message: 'Order lines linked to a supplier order cannot be removed or changed',
              action: 'client_order.update.conflict',
              entityType: 'client_order',
              entityId: idResult.value,
              details: {
                targetLabel: idResult.value,
                secondaryLabel: 'supplier_linked_items_locked',
                changedFields: ['items'],
              },
            });
          }
        }
      }

      let linkedQuoteIdValue: string | null = null;
      if (nextLinkedOfferId !== null) {
        if (existingOrder.linkedOfferId && existingOrder.linkedOfferId !== nextLinkedOfferId) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Orders cannot be relinked to a different offer',
            action: 'client_order.update.conflict',
            entityType: 'client_order',
            entityId: idResult.value,
            details: { secondaryLabel: 'cannot_relink_offer' },
          });
        }

        const offer = await clientsOrdersRepo.findOfferDetails(nextLinkedOfferId);
        if (!offer) {
          return replyError(request, reply, {
            statusCode: 404,
            message: 'Source offer not found',
            action: 'client_order.update.not_found',
            entityType: 'client_offer',
            entityId: nextLinkedOfferId,
          });
        }
        if (offer.status !== 'accepted') {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Sale orders can only be created from accepted offers',
            action: 'client_order.update.conflict',
            entityType: 'client_offer',
            entityId: nextLinkedOfferId,
            details: { secondaryLabel: 'source_offer_not_accepted', fromValue: offer.status },
          });
        }
        if (existingOrder.linkedQuoteId && existingOrder.linkedQuoteId !== offer.linkedQuoteId) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'The selected offer does not match the order quote link',
            action: 'client_order.update.conflict',
            entityType: 'client_order',
            entityId: idResult.value,
            details: { secondaryLabel: 'offer_quote_mismatch' },
          });
        }

        if (await clientsOrdersRepo.findExistingForOffer(nextLinkedOfferId, idResult.value)) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'A sale order already exists for this offer',
            action: 'client_order.update.conflict',
            entityType: 'client_offer',
            entityId: nextLinkedOfferId,
            details: { secondaryLabel: 'duplicate_order_for_offer' },
          });
        }

        linkedQuoteIdValue = offer.linkedQuoteId || null;
      }

      const willReplaceItems =
        (!isSourceLinkedOrder || allowSourceLinkedEdit) && items !== undefined;

      let hasContentChanges = false;
      if ((!isSourceLinkedOrder || allowSourceLinkedEdit) && hasLockedFieldUpdates) {
        if (
          nextLinkedOfferId !== null ||
          (clientIdValue !== undefined &&
            clientIdValue !== null &&
            clientIdValue !== existingOrder.clientId) ||
          (clientNameValue !== undefined &&
            clientNameValue !== null &&
            clientNameValue !== existingOrder.clientName) ||
          (paymentTerms !== undefined && paymentTerms !== existingOrder.paymentTerms) ||
          (discountValue !== undefined &&
            discountValue !== null &&
            Number(discountValue) !== Number(existingOrder.discount)) ||
          (discountTypeValue !== undefined && discountTypeValue !== existingOrder.discountType) ||
          (notes !== undefined &&
            normalizeNotesValue(notes) !== normalizeNotesValue(existingOrder.notes))
        ) {
          hasContentChanges = true;
        }
        if (!hasContentChanges && items !== undefined) {
          if (existingItems === null) {
            existingItems = await clientsOrdersRepo.findItemsForOrder(idResult.value);
          }
          if (itemsChangedForSnapshot(existingItems, normalizedItems ?? [])) {
            hasContentChanges = true;
          }
        }
      }
      const shouldSnapshot = hasContentChanges;

      let result: {
        order: clientsOrdersRepo.ClientOrder | null;
        items: clientsOrdersRepo.ClientOrderItem[];
      };
      try {
        result = await withDbTransaction(async (tx) => {
          if (shouldSnapshot) {
            await snapshotPreState(idResult.value, 'update', request, tx);
          }
          const patch: clientsOrdersRepo.ClientOrderUpdate = {};
          if (nextLinkedOfferId !== null) {
            patch.linkedOfferId = nextLinkedOfferId;
            patch.linkedQuoteId = linkedQuoteIdValue;
          }
          if (clientIdValue !== undefined && clientIdValue !== null) {
            patch.clientId = clientIdValue;
          }
          if (clientNameValue !== undefined && clientNameValue !== null) {
            patch.clientName = clientNameValue;
          }
          if (typeof paymentTerms === 'string') patch.paymentTerms = paymentTerms;
          if (discountValue !== undefined && discountValue !== null) {
            patch.discount = discountValue;
          }
          if (discountTypeValue !== undefined) patch.discountType = discountTypeValue;
          if (typeof status === 'string') patch.status = status;
          if (notes !== undefined) patch.notes = notes as string | null;

          let renamedOrder: clientsOrdersRepo.ClientOrder | null = null;
          if (nextIdValue && nextIdValue !== idResult.value) {
            renamedOrder = await clientsOrdersRepo.rename(idResult.value, nextIdValue, tx);
            if (!renamedOrder) return { order: null, items: [] };
            await reserveDocumentCodeCounterFromCode('client_order', nextIdValue, tx);
          }
          // id-only renames have nothing left to write — reuse the row returned by rename().
          const order =
            Object.keys(patch).length === 0 && renamedOrder
              ? renamedOrder
              : await clientsOrdersRepo.update(renamedOrder?.id ?? idResult.value, patch, tx);
          if (!order) return { order: null, items: [] };

          let nextItems: clientsOrdersRepo.ClientOrderItem[];
          if (isSourceLinkedOrder && !allowSourceLinkedEdit) {
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
        const dup = getUniqueViolation(error);
        if (dup) {
          if (dup.constraint === 'sales_pkey' || dup.detail?.includes('(id)')) {
            return replyError(request, reply, {
              statusCode: 409,
              message: 'Order ID already exists',
              action: 'client_order.update.conflict',
              entityType: 'client_order',
              entityId: idResult.value,
              details: { secondaryLabel: 'duplicate_id' },
            });
          }
          if (
            dup.constraint === 'idx_sales_linked_offer_id_unique' ||
            dup.detail?.includes('(linked_offer_id)')
          ) {
            return replyError(request, reply, {
              statusCode: 409,
              message: 'A sale order already exists for this offer',
              action: 'client_order.update.conflict',
              entityType: 'client_offer',
              entityId: nextLinkedOfferId ?? undefined,
              details: { secondaryLabel: 'duplicate_order_for_offer' },
            });
          }
        }
        throw error;
      }

      const updatedOrder = result.order;
      const updatedItems = result.items;
      if (!updatedOrder) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Order not found',
          action: 'client_order.update.not_found',
          entityType: 'client_order',
          entityId: idResult.value,
        });
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

  fastify.get(
    '/:id/versions',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('accounting.clients_orders.view'),
      ],
      schema: {
        tags: ['clients-orders'],
        summary: 'List versions for a client order',
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
        clientsOrdersRepo.existsById(idResult.value),
        orderVersionsRepo.listForOrder(idResult.value),
      ]);
      if (!exists) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Order not found',
          action: 'client_order.versions_list.not_found',
          entityType: 'client_order',
          entityId: idResult.value,
        });
      }
      return versions;
    },
  );

  fastify.get(
    '/:id/versions/:versionId',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('accounting.clients_orders.view'),
      ],
      schema: {
        tags: ['clients-orders'],
        summary: 'Get a single client order version',
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

      const version = await orderVersionsRepo.findById(idResult.value, versionIdResult.value);
      if (!version) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Version not found',
          action: 'client_order.version_get.not_found',
          entityType: 'client_order',
          entityId: idResult.value,
          details: { secondaryLabel: versionIdResult.value },
        });
      }
      return version;
    },
  );

  fastify.post(
    '/:id/versions/:versionId/restore',
    {
      onRequest: [requirePermission('accounting.clients_orders.update')],
      schema: {
        tags: ['clients-orders'],
        summary: 'Restore a client order to a prior version',
        params: versionParamSchema,
        response: {
          200: clientOrderSchema,
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

      const [current, version] = await Promise.all([
        clientsOrdersRepo.findExisting(idResult.value),
        orderVersionsRepo.findById(idResult.value, versionIdResult.value),
      ]);

      if (!current) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Order not found',
          action: 'client_order.restore.not_found',
          entityType: 'client_order',
          entityId: idResult.value,
        });
      }
      // Draft orders are restorable regardless of an offer/quote link. Restoring a historical
      // snapshot can change identity and line structure, so restore remains draft-only even
      // though confirmed orders allow commercial edits through PUT.
      if (current.status !== 'draft') {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Client order version restore is only available for draft orders',
          action: 'client_order.restore.conflict',
          entityType: 'client_order',
          entityId: idResult.value,
          details: { secondaryLabel: 'restore_requires_draft', fromValue: current.status },
          extraBody: { currentStatus: current.status },
        });
      }
      if (!version) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Version not found',
          action: 'client_order.restore.not_found',
          entityType: 'client_order',
          entityId: idResult.value,
          details: { secondaryLabel: versionIdResult.value },
        });
      }
      const snapshotDiscountResult = optionalLocalizedDocumentDiscount(
        version.snapshot.order.discount,
        version.snapshot.order.discountType,
        'discount',
      );
      if (!snapshotDiscountResult.ok) {
        return replyError(request, reply, {
          statusCode: 409,
          message: `Snapshot has an invalid discount: ${snapshotDiscountResult.message}`,
          action: 'client_order.restore.conflict',
          entityType: 'client_order',
          entityId: idResult.value,
          details: { secondaryLabel: 'snapshot_discount_invalid' },
        });
      }
      const snapshotReferenceValidation = await validateSnapshotReferences(version.snapshot);
      if (snapshotReferenceValidation.error) {
        return replyError(request, reply, {
          statusCode: 409,
          message: snapshotReferenceValidation.error,
          action: 'client_order.restore.conflict',
          entityType: 'client_order',
          entityId: idResult.value,
          details: { secondaryLabel: 'snapshot_reference_missing' },
        });
      }

      const snapshotItems: clientsOrdersRepo.NewClientOrderItem[] = version.snapshot.items.map(
        ({ orderId: _o, id: _i, ...rest }) => {
          const supplierQuoteItemId = normalizeNullableString(rest.supplierQuoteItemId);
          const supplierQuoteItem = supplierQuoteItemId
            ? snapshotReferenceValidation.supplierQuoteItems.get(supplierQuoteItemId)
            : undefined;
          return withCalculatedClientLineMol({
            ...rest,
            id: generatePrefixedId(ITEM_ID_PREFIXES.saleItem),
            // Supplier sourcing metadata is authoritative and product-less quote items must stay
            // product-less. A quote id without an item reference is not a sourcing relationship.
            productId: supplierQuoteItem ? supplierQuoteItem.productId : rest.productId || null,
            supplierQuoteId: supplierQuoteItem?.supplierQuoteId ?? null,
            supplierQuoteItemId,
            supplierQuoteSupplierName: supplierQuoteItem?.supplierName ?? null,
            supplierQuoteUnitPrice: supplierQuoteItem?.netCost ?? null,
          });
        },
      );

      let restored: {
        order: clientsOrdersRepo.ClientOrder | null;
        items: clientsOrdersRepo.ClientOrderItem[];
      };
      try {
        restored = await withDbTransaction(async (tx) => {
          await snapshotPreState(idResult.value, 'restore', request, tx);

          const order = await clientsOrdersRepo.restoreSnapshotOrder(
            idResult.value,
            {
              clientId: version.snapshot.order.clientId,
              clientName: version.snapshot.order.clientName,
              paymentTerms: version.snapshot.order.paymentTerms,
              discount: version.snapshot.order.discount,
              discountType: version.snapshot.order.discountType,
              status: version.snapshot.order.status,
              notes: version.snapshot.order.notes,
              // Preserve link IDs across restore (legacy snapshots may omit these; the repo
              // only writes the columns when the keys are explicitly present, so live links
              // survive on older snapshots).
              ...(Object.hasOwn(version.snapshot.order, 'linkedQuoteId')
                ? { linkedQuoteId: version.snapshot.order.linkedQuoteId ?? null }
                : {}),
              ...(Object.hasOwn(version.snapshot.order, 'linkedOfferId')
                ? { linkedOfferId: version.snapshot.order.linkedOfferId ?? null }
                : {}),
            },
            tx,
          );
          if (!order) return { order: null, items: [] };
          const items = await clientsOrdersRepo.replaceItems(order.id, snapshotItems, tx);
          return { order, items };
        });
      } catch (error) {
        // Restoring linkedOfferId can collide with the partial unique index
        // `idx_sales_linked_offer_id_unique` when that offer is now linked to a different
        // order. Surface a 409 instead of leaking the 23505 as a 500.
        const dup = getUniqueViolation(error);
        if (
          dup &&
          (dup.constraint === 'idx_sales_linked_offer_id_unique' ||
            dup.detail?.includes('(linked_offer_id)'))
        ) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Snapshot links to an offer that is already linked to another order',
            action: 'client_order.restore.conflict',
            entityType: 'client_order',
            entityId: idResult.value,
            details: { secondaryLabel: 'snapshot_offer_link_taken' },
          });
        }
        // The pre-tx reference check is racy - a referenced client/product can be deleted
        // between validation and the restore writes. Translate the resulting FK violation to a
        // 409 instead of leaking a 500.
        if (getForeignKeyViolation(error)) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Snapshot references a client or product that no longer exists',
            action: 'client_order.restore.conflict',
            entityType: 'client_order',
            entityId: idResult.value,
            details: { secondaryLabel: 'snapshot_fk_violation' },
          });
        }
        throw error;
      }

      if (!restored.order) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Order not found',
          action: 'client_order.restore.not_found',
          entityType: 'client_order',
          entityId: idResult.value,
        });
      }

      await logAudit({
        request,
        action: 'client_order.restored',
        entityType: 'client_order',
        entityId: restored.order.id,
        details: {
          targetLabel: restored.order.id,
          secondaryLabel: restored.order.clientName,
          toValue: versionIdResult.value,
        },
      });

      return { ...restored.order, items: restored.items };
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
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Order not found',
          action: 'client_order.delete.not_found',
          entityType: 'client_order',
          entityId: idResult.value,
        });
      }
      if (order.status !== 'draft') {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Only draft clients_orders can be deleted',
          action: 'client_order.delete.conflict',
          entityType: 'client_order',
          entityId: idResult.value,
          details: { secondaryLabel: 'non_draft_status', fromValue: order.status },
          extraBody: { currentStatus: order.status },
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
