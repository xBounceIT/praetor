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
import { logAudit } from '../utils/audit.ts';
import { isPastLocalDate } from '../utils/date.ts';
import { getForeignKeyViolation, getUniqueViolation } from '../utils/db-errors.ts';
import type { DurationUnit } from '../utils/duration-unit.ts';
import { normalizeNullableNumber, normalizeNullableString } from '../utils/normalize.ts';
import {
  generateClientOrderId,
  generatePrefixedId,
  generateSupplierOrderId,
  ITEM_ID_PREFIXES,
} from '../utils/order-ids.ts';
import { effectiveSupplierQuoteStatus } from '../utils/quote-status.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { replyError } from '../utils/replyError.ts';
import { normalizeUnitType, type UnitType } from '../utils/unit-type.ts';
import {
  badRequest,
  optionalDurationMonths,
  optionalDurationUnit,
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
    supplierQuoteId: { type: ['string', 'null'] },
    supplierQuoteItemId: { type: ['string', 'null'] },
    supplierQuoteSupplierName: { type: ['string', 'null'] },
    supplierQuoteUnitPrice: { type: ['number', 'null'] },
    supplierSaleId: { type: ['string', 'null'] },
    supplierSaleItemId: { type: ['string', 'null'] },
    supplierSaleSupplierName: { type: ['string', 'null'] },
    unitType: { type: 'string', enum: ['hours', 'days', 'unit'] },
    discount: { type: 'number' },
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
    const itemDiscountResult = optionalLocalizedNonNegativeNumber(
      item.discount,
      `items[${i}].discount`,
    );
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
      // Normalized above so the stored values match the productId-vs-supplier-quote gate.
      supplierQuoteId,
      supplierQuoteItemId,
      supplierQuoteSupplierName: normalizeNullableString(item.supplierQuoteSupplierName),
      supplierQuoteUnitPrice: normalizeNullableNumber(item.supplierQuoteUnitPrice),
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

// A product-less line (`productId === null`) has the supplier-quote reference as its only anchor,
// and `sale_items.supplier_quote_*` has no FK. Resolve each referenced item against *accepted*
// supplier quotes — the same authoritative source the client-quotes route trusts — and stamp the
// supplier fields from the snapshot. Without this, a direct POST/PUT could persist a line with
// bogus or non-accepted refs (the supplier-order auto-create silently skips them) that the UI
// still locks as supplier-backed. Returns null after replying 400 if a reference can't be resolved.
const resolveSupplierQuoteRefs = async (
  items: NormalizedOrderItem[],
  reply: FastifyReply,
): Promise<NormalizedOrderItem[] | null> => {
  const productlessItemIds = items.flatMap((item) =>
    item.productId === null && item.supplierQuoteItemId ? [item.supplierQuoteItemId] : [],
  );
  if (productlessItemIds.length === 0) return items;

  const snapshots = await supplierQuotesRepo.getQuoteItemSnapshots(productlessItemIds);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.productId !== null || !item.supplierQuoteItemId) continue;
    const snapshot = snapshots.get(item.supplierQuoteItemId);
    if (!snapshot) {
      badRequest(
        reply,
        `items[${i}].supplierQuoteItemId "${item.supplierQuoteItemId}" is invalid or its supplier quote is not accepted`,
      );
      return null;
    }
    // Trust the snapshot, not the client: stamp the authoritative quote id, supplier name and unit
    // price so the persisted line is tied to the real accepted quote and the supplier-order
    // auto-create keys off a valid supplierQuoteId. A catalog-backed supplier-quote item also
    // carries a real productId — adopt it (mirroring the client-quotes resolver) so the sale isn't
    // stored product-less and stays visible to product quick-links and catalog usage/revenue reports.
    items[i] = {
      ...item,
      productId: snapshot.productId ?? item.productId,
      supplierQuoteId: snapshot.supplierQuoteId,
      supplierQuoteSupplierName: snapshot.supplierName,
      supplierQuoteUnitPrice: snapshot.netCost,
    };
  }
  return items;
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

// Fingerprint covers every field that flows into the JSONB snapshot, so cost / MOL / note /
// unit-type / supplier-source edits all flip the change flag. The looser `itemsMatch` above
// only powers the source-linked rejection check and is intentionally untouched here.
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
    item.productMolPercentage == null ? '' : Number(item.productMolPercentage),
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

  const findMissingSnapshotReference = async (
    snapshot: orderVersionsRepo.OrderVersionSnapshot,
  ): Promise<string | null> => {
    const productIds = Array.from(
      new Set(
        snapshot.items
          .map((item) => item.productId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    );
    const [clientExists, products] = await Promise.all([
      clientsRepo.existsById(snapshot.order.clientId),
      productIds.length > 0 ? productsRepo.getSnapshots(productIds) : Promise.resolve(new Map()),
    ]);
    if (!clientExists) {
      return `Snapshot client "${snapshot.order.clientId}" no longer exists`;
    }
    const missingProductId = productIds.find((id) => !products.has(id));
    if (missingProductId) {
      return `Snapshot product "${missingProductId}" no longer exists`;
    }
    // A product-less snapshot item (no catalog product) must resolve to an *accepted* supplier-quote
    // item — the same invariant POST/PUT enforce. Two failure modes are rejected before any write:
    //  - orphaned: missing either supplier-quote id, so it could never be re-saved through the
    //    POST/PUT presence gate and is invisible to product-based reporting;
    //  - stale: the referenced item was deleted or its quote is no longer accepted, so restoring it
    //    persists a dead reference that the next draft edit (which re-runs `resolveSupplierQuoteRefs`)
    //    rejects, stranding the order in an un-saveable state.
    const productlessItems = snapshot.items.filter(
      (item) => !normalizeNullableString(item.productId),
    );
    const orphanedItem = productlessItems.find(
      (item) =>
        !(
          normalizeNullableString(item.supplierQuoteId) &&
          normalizeNullableString(item.supplierQuoteItemId)
        ),
    );
    if (orphanedItem) {
      return `Snapshot item "${orphanedItem.productName}" has no catalog product and no supplier-quote reference`;
    }
    const supplierQuoteItemIds = productlessItems
      .map((item) => normalizeNullableString(item.supplierQuoteItemId))
      .filter((id): id is string => id !== null);
    if (supplierQuoteItemIds.length > 0) {
      const quoteItemSnapshots =
        await supplierQuotesRepo.getQuoteItemSnapshots(supplierQuoteItemIds);
      const staleItem = productlessItems.find((item) => {
        const itemId = normalizeNullableString(item.supplierQuoteItemId);
        return itemId !== null && !quoteItemSnapshots.has(itemId);
      });
      if (staleItem) {
        return `Snapshot item "${staleItem.productName}" references a supplier quote that no longer exists or is not accepted`;
      }
    }
    return null;
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
      const normalizedItems = await resolveSupplierQuoteRefs(parsedItems, reply);
      if (!normalizedItems) return;

      const discountResult = optionalLocalizedNonNegativeNumber(discount, 'discount');
      if (!discountResult.ok) return badRequest(reply, discountResult.message);
      const discountTypeValue = discountType === 'currency' ? 'currency' : 'percentage';

      let linkedQuoteIdValue = linkedQuoteIdResult.value;
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
      }

      const orderId = nextIdResult.value || (await generateClientOrderId());

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
            order.id,
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
          // Cheap fast-fail outside any tx: skip if the quote isn't accepted or already has a
          // linked order. The authoritative decision is repeated inside the tx below under a
          // row lock; this read just avoids opening an empty transaction in the common case.
          const [fastFailQuote, fastFailLinked] = await Promise.all([
            supplierQuotesRepo.findById(sqId),
            supplierQuotesRepo.findLinkedOrderId(sqId),
          ]);
          if (
            !fastFailQuote ||
            effectiveSupplierQuoteStatus({
              ownStatus: fastFailQuote.status,
              linkedClientStatus: fastFailQuote.linkedClientQuoteStatus,
              isPastOwnExpiration: fastFailQuote.expirationDate
                ? isPastLocalDate(fastFailQuote.expirationDate)
                : false,
            }) !== 'accepted'
          )
            continue;
          if (fastFailLinked) continue;

          const autoCreated = await withDbTransaction(async (tx) => {
            // Lock the supplier quote so concurrent client-order POSTs that reference the
            // same quote serialize here, then re-read the gating state AND the metadata we
            // copy onto the new supplier order under the lock. `fastFailQuote` from the
            // pre-tx read isn't reused because a metadata update could have committed
            // between that read and lock acquisition, landing stale supplier name / payment
            // terms on the auto-created order.
            const lockedStatus = await supplierQuotesRepo.lockEffectiveStatusById(sqId, tx);
            if (
              !lockedStatus ||
              effectiveSupplierQuoteStatus({
                ownStatus: lockedStatus.ownStatus,
                linkedClientStatus: lockedStatus.linkedClientStatus,
                isPastOwnExpiration: lockedStatus.expirationDate
                  ? isPastLocalDate(lockedStatus.expirationDate)
                  : false,
              }) !== 'accepted'
            )
              return false;
            const linkedUnderLock = await supplierQuotesRepo.findLinkedOrderId(sqId, tx);
            if (linkedUnderLock) return false;
            const supplierQuote = await supplierQuotesRepo.findById(sqId, tx);
            if (!supplierQuote) return false;
            const supplierItems = await supplierQuotesRepo.findItemsForQuote(sqId, tx);
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
              const saleItemId = generatePrefixedId(ITEM_ID_PREFIXES.supplierItem);
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
            return true;
          });
          if (autoCreated) didAutoCreate = true;
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
        const parsedItems = normalizeIncomingItems(items, reply);
        if (!parsedItems) return;
        normalizedItems = await resolveSupplierQuoteRefs(parsedItems, reply);
        if (!normalizedItems) return;
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
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Non-draft clients_orders are read-only',
          action: 'client_order.update.conflict',
          entityType: 'client_order',
          entityId: idResult.value,
          details: { secondaryLabel: 'non_draft_read_only', fromValue: existingOrder.status },
          extraBody: { currentStatus: existingOrder.status },
        });
      }

      const isSourceLinkedOrder = Boolean(
        existingOrder.linkedQuoteId || existingOrder.linkedOfferId,
      );
      // A draft order created from an offer/quote is the live downstream document and stays
      // fully editable. Non-draft orders are already fully locked by the status gate above
      // (hasLockedFieldUpdates), so relaxing the source-linked lock only ever opens up drafts.
      const allowSourceLinkedEdit = existingOrder.status === 'draft';

      let existingItems: clientsOrdersRepo.ClientOrderItem[] | null = null;

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
      if (linkedOfferId !== undefined && linkedOfferIdValue) {
        if (existingOrder.linkedOfferId && existingOrder.linkedOfferId !== linkedOfferIdValue) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Orders cannot be relinked to a different offer',
            action: 'client_order.update.conflict',
            entityType: 'client_order',
            entityId: idResult.value,
            details: { secondaryLabel: 'cannot_relink_offer' },
          });
        }

        const offer = await clientsOrdersRepo.findOfferDetails(linkedOfferIdValue);
        if (!offer) {
          return replyError(request, reply, {
            statusCode: 404,
            message: 'Source offer not found',
            action: 'client_order.update.not_found',
            entityType: 'client_offer',
            entityId: linkedOfferIdValue,
          });
        }
        if (offer.status !== 'accepted') {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Sale orders can only be created from accepted offers',
            action: 'client_order.update.conflict',
            entityType: 'client_offer',
            entityId: linkedOfferIdValue,
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

        if (await clientsOrdersRepo.findExistingForOffer(linkedOfferIdValue, idResult.value)) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'A sale order already exists for this offer',
            action: 'client_order.update.conflict',
            entityType: 'client_offer',
            entityId: linkedOfferIdValue,
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
          (linkedOfferIdValue !== undefined &&
            linkedOfferIdValue !== existingOrder.linkedOfferId) ||
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
          if (linkedOfferId !== undefined && linkedOfferIdValue) {
            patch.linkedOfferId = linkedOfferIdValue;
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
              entityId: linkedOfferIdValue ?? undefined,
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
      // Draft orders are restorable regardless of an offer/quote link — they are editable, so
      // their version history must be reversible too (the restore preserves the link IDs and
      // the snapshot/replaceItems path below carries supplier references). Non-draft orders stay
      // read-only via the status check below; for them the version panel is disabled in the UI.
      if (current.status !== 'draft') {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Non-draft clients_orders are read-only',
          action: 'client_order.restore.conflict',
          entityType: 'client_order',
          entityId: idResult.value,
          details: { secondaryLabel: 'non_draft_read_only', fromValue: current.status },
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
      const missingSnapshotReference = await findMissingSnapshotReference(version.snapshot);
      if (missingSnapshotReference) {
        return replyError(request, reply, {
          statusCode: 409,
          message: missingSnapshotReference,
          action: 'client_order.restore.conflict',
          entityType: 'client_order',
          entityId: idResult.value,
          details: { secondaryLabel: 'snapshot_reference_missing' },
        });
      }

      // `sale_items.product_id` is nullable (issue #783), so a product-less supplier line in the
      // snapshot restores as-is. `findMissingSnapshotReference` above already rejected stale
      // productIds and orphaned product-less items (no product AND no supplier-quote reference).
      const snapshotItems: clientsOrdersRepo.NewClientOrderItem[] = version.snapshot.items.map(
        ({ orderId: _o, id: _i, ...rest }) => ({
          ...rest,
          id: generatePrefixedId(ITEM_ID_PREFIXES.saleItem),
          // Empty-string productIds slip through some snapshots; the DB column needs NULL.
          productId: rest.productId || null,
        }),
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
