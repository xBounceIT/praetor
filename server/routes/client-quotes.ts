import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type DbExecutor, withDbTransaction } from '../db/drizzle.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as clientQuotesRepo from '../repositories/clientQuotesRepo.ts';
import * as productsRepo from '../repositories/productsRepo.ts';
import * as quoteVersionsRepo from '../repositories/quoteVersionsRepo.ts';
import * as supplierQuotesRepo from '../repositories/supplierQuotesRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { isPastLocalDate } from '../utils/date.ts';
import { getUniqueViolation } from '../utils/db-errors.ts';
import { generateItemId } from '../utils/order-ids.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { normalizeUnitType, type UnitType } from '../utils/unit-type.ts';
import {
  badRequest,
  optionalDateString,
  optionalLocalizedNonNegativeNumber,
  optionalNonEmptyString,
  parseDateString,
  parseLocalizedNonNegativeNumber,
  parseLocalizedPositiveNumber,
  requireNonEmptyString,
} from '../utils/validation.ts';

type IncomingQuoteItem = {
  id?: string;
  productId: string | null;
  productName: string;
  supplierQuoteItemId?: string | null;
  quantity: number;
  unitPrice: number;
  productCost: number | null;
  productMolPercentage: number | null;
  discount: number;
  note?: string | null;
  unitType?: UnitType;
};

type QuoteItemSnapshot = {
  productCost: number;
  productMolPercentage: number | null;
  supplierQuoteId: string | null;
  supplierQuoteItemId: string | null;
  supplierQuoteSupplierName: string | null;
  supplierQuoteUnitPrice: number | null;
};

type ResolvedQuoteItem = IncomingQuoteItem & QuoteItemSnapshot;

const normalizeNullableString = (value: unknown) => {
  if (value === undefined || value === null) return null;
  const stringValue = String(value).trim();
  return stringValue.length > 0 ? stringValue : null;
};

const normalizeQuoteItems = (
  items: unknown[],
): { ok: true; items: IncomingQuoteItem[] } | { ok: false; message: string } => {
  const result: IncomingQuoteItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as Record<string, unknown>;
    const itemSupplierQuoteItemId = normalizeNullableString(item.supplierQuoteItemId);
    const productIdValue = typeof item.productId === 'string' ? item.productId.trim() : '';
    if (!productIdValue && !itemSupplierQuoteItemId) {
      return {
        ok: false,
        message: `items[${i}].productId is required when no supplierQuoteItemId is provided`,
      };
    }

    const productNameResult = requireNonEmptyString(item.productName, `items[${i}].productName`);
    if (!productNameResult.ok) return { ok: false, message: productNameResult.message };
    const quantityResult = parseLocalizedPositiveNumber(item.quantity, `items[${i}].quantity`);
    if (!quantityResult.ok) return { ok: false, message: quantityResult.message };
    const unitPriceResult = parseLocalizedNonNegativeNumber(
      item.unitPrice,
      `items[${i}].unitPrice`,
    );
    if (!unitPriceResult.ok) return { ok: false, message: unitPriceResult.message };
    const itemDiscountResult = optionalLocalizedNonNegativeNumber(
      item.discount,
      `items[${i}].discount`,
    );
    if (!itemDiscountResult.ok) return { ok: false, message: itemDiscountResult.message };
    const productCostResult = optionalLocalizedNonNegativeNumber(
      item.productCost,
      `items[${i}].productCost`,
    );
    if (!productCostResult.ok) return { ok: false, message: productCostResult.message };
    const productMolPercentageResult = optionalLocalizedNonNegativeNumber(
      item.productMolPercentage,
      `items[${i}].productMolPercentage`,
    );
    if (!productMolPercentageResult.ok) {
      return { ok: false, message: productMolPercentageResult.message };
    }
    result.push({
      id: normalizeNullableString(item.id) ?? undefined,
      productId: productIdValue,
      productName: productNameResult.value,
      supplierQuoteItemId: itemSupplierQuoteItemId,
      quantity: quantityResult.value,
      unitPrice: unitPriceResult.value,
      productCost: productCostResult.value,
      productMolPercentage: productMolPercentageResult.value,
      discount: itemDiscountResult.value || 0,
      note: normalizeNullableString(item.note),
      unitType: normalizeUnitType(item.unitType),
    });
  }
  return { ok: true, items: result };
};

const calculateQuoteTotals = (
  items: Array<{ quantity: number; unitPrice: number; discount?: number }>,
  globalDiscount: number,
  discountType: 'percentage' | 'currency' = 'percentage',
) => {
  const normalizedGlobalDiscount = Number.isFinite(globalDiscount) ? globalDiscount : 0;
  let subtotal = 0;

  for (const item of items) {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
    const itemDiscount = Number(item.discount ?? 0);
    if (
      !Number.isFinite(quantity) ||
      !Number.isFinite(unitPrice) ||
      !Number.isFinite(itemDiscount)
    ) {
      return {
        total: Number.NaN,
        subtotal: Number.NaN,
      };
    }
    const lineSubtotal = quantity * unitPrice;
    const lineDiscount = lineSubtotal * (itemDiscount / 100);
    const lineNet = lineSubtotal - lineDiscount;
    subtotal += lineNet;
  }

  const discountAmount =
    discountType === 'currency'
      ? Math.min(Math.max(normalizedGlobalDiscount, 0), subtotal)
      : subtotal * (normalizedGlobalDiscount / 100);
  const total = subtotal - discountAmount;
  return { total, subtotal };
};

const resolveQuoteItemSnapshots = async (
  items: IncomingQuoteItem[],
  existingItemsById?: Map<string, IncomingQuoteItem & QuoteItemSnapshot>,
): Promise<ResolvedQuoteItem[]> => {
  const itemsNeedingRecalc = items.filter((item) => {
    if (!existingItemsById || !item.id) return true;
    const existingItem = existingItemsById.get(item.id);
    if (!existingItem) return true;
    return (
      existingItem.productId !== item.productId ||
      normalizeNullableString(existingItem.supplierQuoteItemId) !==
        normalizeNullableString(item.supplierQuoteItemId) ||
      (item.productCost !== null && item.productCost !== existingItem.productCost) ||
      (item.productMolPercentage !== null &&
        item.productMolPercentage !== (existingItem.productMolPercentage ?? null))
    );
  });

  const supplierQuoteSnapshots = await supplierQuotesRepo.getQuoteItemSnapshots(
    itemsNeedingRecalc
      .map((item) => normalizeNullableString(item.supplierQuoteItemId))
      .filter((id): id is string => id !== null),
  );

  const productIds = new Set<string>();
  for (const item of itemsNeedingRecalc) {
    if (item.productId) {
      productIds.add(item.productId);
    }
  }
  for (const supplierQuoteSnapshot of supplierQuoteSnapshots.values()) {
    if (supplierQuoteSnapshot.productId) {
      productIds.add(supplierQuoteSnapshot.productId);
    }
  }
  const productSnapshots = await productsRepo.getSnapshots(Array.from(productIds));

  const resolvedItems: ResolvedQuoteItem[] = [];
  for (const item of items) {
    const normalizedSupplierQuoteItemId = normalizeNullableString(item.supplierQuoteItemId);
    let resolvedProductId = item.productId;

    if (existingItemsById && item.id) {
      const existingItem = existingItemsById.get(item.id);
      const isUnchanged =
        existingItem &&
        existingItem.productId === item.productId &&
        normalizeNullableString(existingItem.supplierQuoteItemId) ===
          normalizedSupplierQuoteItemId &&
        (item.productCost === null || item.productCost === existingItem.productCost) &&
        (item.productMolPercentage === null ||
          item.productMolPercentage === (existingItem.productMolPercentage ?? null));
      if (existingItem && isUnchanged) {
        resolvedItems.push({
          ...item,
          supplierQuoteItemId: normalizedSupplierQuoteItemId,
          productCost: existingItem.productCost,
          productMolPercentage: existingItem.productMolPercentage ?? null,
          supplierQuoteId: existingItem.supplierQuoteId ?? null,
          supplierQuoteSupplierName: existingItem.supplierQuoteSupplierName ?? null,
          supplierQuoteUnitPrice: existingItem.supplierQuoteUnitPrice ?? null,
        });
        continue;
      }
    }

    let supplierQuoteId: string | null = null;
    let supplierQuoteSupplierName: string | null = null;
    let supplierQuoteUnitPrice: number | null = null;

    if (normalizedSupplierQuoteItemId) {
      const supplierQuoteSnapshot = supplierQuoteSnapshots.get(normalizedSupplierQuoteItemId);
      if (!supplierQuoteSnapshot) {
        throw new Error(
          `supplierQuoteItemId "${normalizedSupplierQuoteItemId}" is invalid or supplier quote is not accepted`,
        );
      }
      if (!resolvedProductId && supplierQuoteSnapshot.productId !== null) {
        resolvedProductId = supplierQuoteSnapshot.productId;
      }
      if (
        resolvedProductId &&
        supplierQuoteSnapshot.productId !== resolvedProductId &&
        supplierQuoteSnapshot.productId !== null
      ) {
        throw new Error(
          `supplierQuoteItemId "${normalizedSupplierQuoteItemId}" does not match productId "${resolvedProductId}"`,
        );
      }
      supplierQuoteId = supplierQuoteSnapshot.supplierQuoteId;
      supplierQuoteSupplierName = supplierQuoteSnapshot.supplierName;
      supplierQuoteUnitPrice = supplierQuoteSnapshot.netCost;
    }

    const productSnapshot = resolvedProductId ? productSnapshots.get(resolvedProductId) : undefined;
    if (!productSnapshot && !normalizedSupplierQuoteItemId) {
      throw new Error(`items productId "${resolvedProductId}" is invalid`);
    }

    const allowManualProductSnapshot = !normalizedSupplierQuoteItemId;
    resolvedItems.push({
      ...item,
      productId: resolvedProductId,
      supplierQuoteItemId: normalizedSupplierQuoteItemId,
      productCost:
        allowManualProductSnapshot && item.productCost !== null
          ? item.productCost
          : (productSnapshot?.productCost ?? 0),
      productMolPercentage:
        allowManualProductSnapshot && item.productMolPercentage !== null
          ? item.productMolPercentage
          : (productSnapshot?.productMolPercentage ?? null),
      supplierQuoteId,
      supplierQuoteSupplierName,
      supplierQuoteUnitPrice,
    });
  }

  return resolvedItems;
};

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const quoteItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    quoteId: { type: 'string' },
    productId: { type: 'string' },
    productName: { type: 'string' },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    productCost: { type: 'number' },
    productMolPercentage: { type: ['number', 'null'] },
    supplierQuoteId: { type: ['string', 'null'] },
    supplierQuoteItemId: { type: ['string', 'null'] },
    supplierQuoteSupplierName: { type: ['string', 'null'] },
    supplierQuoteUnitPrice: { type: ['number', 'null'] },
    discount: { type: 'number' },
    note: { type: ['string', 'null'] },
    unitType: { type: 'string', enum: ['hours', 'days', 'unit'] },
  },
  required: [
    'id',
    'quoteId',
    'productId',
    'productName',
    'quantity',
    'unitPrice',
    'productCost',
    'discount',
  ],
} as const;

const quoteSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    linkedOfferId: { type: ['string', 'null'] },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    paymentTerms: { type: ['string', 'null'] },
    discount: { type: 'number' },
    discountType: { type: 'string', enum: ['percentage', 'currency'] },
    status: { type: 'string' },
    expirationDate: { type: ['string', 'null'], format: 'date' },
    notes: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    items: { type: 'array', items: quoteItemSchema },
    isExpired: { type: 'boolean' },
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
    'isExpired',
  ],
} as const;

const quoteItemBodySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    productId: { type: 'string' },
    productName: { type: 'string' },
    supplierQuoteItemId: { type: 'string' },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    productCost: { type: 'number' },
    productMolPercentage: { type: 'number' },
    discount: { type: 'number' },
    note: { type: 'string' },
    unitType: { type: 'string', enum: ['hours', 'days', 'unit'] },
  },
  required: ['productId', 'productName', 'quantity', 'unitPrice'],
} as const;

const quoteCreateBodySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    items: { type: 'array', items: quoteItemBodySchema },
    paymentTerms: { type: 'string' },
    discount: { type: 'number' },
    discountType: { type: 'string', enum: ['percentage', 'currency'] },
    status: { type: 'string' },
    expirationDate: { type: 'string', format: 'date' },
    notes: { type: 'string' },
  },
  required: ['id', 'clientId', 'clientName', 'items', 'expirationDate'],
} as const;

const quoteUpdateBodySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    items: { type: 'array', items: quoteItemBodySchema },
    paymentTerms: { type: 'string' },
    discount: { type: 'number' },
    discountType: { type: 'string', enum: ['percentage', 'currency'] },
    status: { type: 'string' },
    expirationDate: { type: 'string', format: 'date' },
    notes: { type: 'string' },
    isExpired: { type: 'boolean' },
  },
} as const;

const generateQuoteItemId = () => generateItemId('qi-');

const buildItemsForInsert = (items: ResolvedQuoteItem[]): clientQuotesRepo.NewClientQuoteItem[] =>
  items.map((item) => ({
    id: generateQuoteItemId(),
    productId: item.productId || null,
    productName: item.productName,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    productCost: item.productCost ?? 0,
    productMolPercentage: item.productMolPercentage ?? null,
    discount: item.discount || 0,
    note: item.note || null,
    supplierQuoteId: item.supplierQuoteId ?? null,
    supplierQuoteItemId: item.supplierQuoteItemId ?? null,
    supplierQuoteSupplierName: item.supplierQuoteSupplierName ?? null,
    supplierQuoteUnitPrice: item.supplierQuoteUnitPrice ?? null,
    unitType: item.unitType ?? 'hours',
  }));

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.addHook('onRequest', authenticateToken);

  const isQuoteExpired = (status: string, expirationDate: string | null | undefined) => {
    if (status === 'confirmed') return false;
    if (!expirationDate) return false;
    return isPastLocalDate(expirationDate);
  };

  const snapshotPreState = async (
    quoteId: string,
    reason: quoteVersionsRepo.QuoteVersionReason,
    request: FastifyRequest,
    tx: DbExecutor,
  ) => {
    const pre = await clientQuotesRepo.findFullForSnapshot(quoteId, tx);
    if (!pre) return;
    await quoteVersionsRepo.insert(
      {
        quoteId,
        snapshot: quoteVersionsRepo.buildSnapshot(pre.quote, pre.items),
        reason,
        createdByUserId: request.user?.id ?? null,
      },
      tx,
    );
  };

  // GET / - List all quotes with their items
  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('sales.client_quotes.view'),
      ],
      schema: {
        tags: ['client-quotes'],
        summary: 'List client quotes',
        response: {
          200: { type: 'array', items: quoteSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      const [quotes, items] = await Promise.all([
        clientQuotesRepo.listAll(),
        clientQuotesRepo.listAllItems(),
      ]);

      const itemsByQuote = new Map<string, clientQuotesRepo.ClientQuoteItem[]>();
      for (const item of items) {
        const list = itemsByQuote.get(item.quoteId);
        if (list) list.push(item);
        else itemsByQuote.set(item.quoteId, [item]);
      }

      return quotes.map((quote) => ({
        ...quote,
        items: itemsByQuote.get(quote.id) ?? [],
        isExpired: isQuoteExpired(quote.status, quote.expirationDate),
      }));
    },
  );

  // POST / - Create quote with items
  fastify.post(
    '/',
    {
      onRequest: [requirePermission('sales.client_quotes.create')],
      schema: {
        tags: ['client-quotes'],
        summary: 'Create client quote',
        body: quoteCreateBodySchema,
        response: {
          201: quoteSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        id: nextId,
        clientId,
        clientName,
        items,
        paymentTerms,
        discount,
        discountType,
        status,
        expirationDate,
        notes,
      } = request.body as {
        id: unknown;
        clientId: unknown;
        clientName: unknown;
        items: unknown;
        paymentTerms: unknown;
        discount: unknown;
        discountType: unknown;
        status: unknown;
        expirationDate: unknown;
        notes: unknown;
      };

      const nextIdResult = requireNonEmptyString(nextId, 'id');
      if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);

      const clientIdResult = requireNonEmptyString(clientId, 'clientId');
      if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);

      const clientNameResult = requireNonEmptyString(clientName, 'clientName');
      if (!clientNameResult.ok) return badRequest(reply, clientNameResult.message);

      if (!Array.isArray(items) || items.length === 0) {
        return badRequest(reply, 'Items must be a non-empty array');
      }

      const itemsResult = normalizeQuoteItems(items);
      if (!itemsResult.ok) return badRequest(reply, itemsResult.message);
      const normalizedItems = itemsResult.items;

      const expirationDateResult = parseDateString(expirationDate, 'expirationDate');
      if (!expirationDateResult.ok) return badRequest(reply, expirationDateResult.message);

      const discountResult = optionalLocalizedNonNegativeNumber(discount, 'discount');
      if (!discountResult.ok) return badRequest(reply, discountResult.message);
      const discountValue = discountResult.value || 0;
      const discountTypeValue = discountType === 'currency' ? 'currency' : 'percentage';

      let resolvedItems: ResolvedQuoteItem[];
      try {
        resolvedItems = await resolveQuoteItemSnapshots(normalizedItems);
      } catch (err) {
        return badRequest(reply, (err as Error).message);
      }

      const totals = calculateQuoteTotals(resolvedItems, discountValue, discountTypeValue);
      if (!Number.isFinite(totals.total) || totals.total <= 0) {
        return badRequest(reply, 'Total must be greater than 0');
      }

      try {
        const { quote, createdItems } = await withDbTransaction(async (tx) => {
          const created = await clientQuotesRepo.create(
            {
              id: nextIdResult.value,
              clientId: clientIdResult.value,
              clientName: clientNameResult.value,
              paymentTerms:
                typeof paymentTerms === 'string' && paymentTerms ? paymentTerms : 'immediate',
              discount: discountValue,
              discountType: discountTypeValue,
              status: typeof status === 'string' && status ? status : 'draft',
              expirationDate: expirationDateResult.value,
              notes: (notes as string | null | undefined) ?? null,
            },
            tx,
          );
          const items = await clientQuotesRepo.insertItems(
            created.id,
            buildItemsForInsert(resolvedItems),
            tx,
          );
          return { quote: created, createdItems: items };
        });

        await logAudit({
          request,
          action: 'client_quote.created',
          entityType: 'client_quote',
          entityId: nextIdResult.value,
          details: {
            targetLabel: nextIdResult.value,
            secondaryLabel: clientNameResult.value,
          },
        });
        return reply.code(201).send({
          ...quote,
          items: createdItems,
          isExpired: isQuoteExpired(quote.status, quote.expirationDate),
        });
      } catch (err) {
        const dup = getUniqueViolation(err);
        if (dup && (dup.constraint === 'quotes_pkey' || dup.detail?.includes('(id)'))) {
          return reply.code(409).send({ error: 'Quote ID already exists' });
        }
        request.log.error({ err }, 'CRITICAL ERROR creating quote');
        return reply.code(500).send({ error: `Internal Server Error: ${(err as Error).message}` });
      }
    },
  );

  // PUT /:id - Update quote
  fastify.put(
    '/:id',
    {
      onRequest: [requirePermission('sales.client_quotes.update')],
      schema: {
        tags: ['client-quotes'],
        summary: 'Update client quote',
        params: idParamSchema,
        body: quoteUpdateBodySchema,
        response: {
          200: quoteSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const {
        id: nextId,
        clientId,
        clientName,
        items,
        paymentTerms,
        discount,
        discountType,
        status,
        expirationDate,
        notes,
        isExpired: isExpiredOverride,
      } = request.body as {
        id: unknown;
        clientId: unknown;
        clientName: unknown;
        items: unknown;
        paymentTerms: unknown;
        discount: unknown;
        discountType: unknown;
        status: unknown;
        expirationDate: unknown;
        notes: unknown;
        isExpired: unknown;
      };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const isIdOnlyUpdate =
        nextId !== undefined &&
        clientId === undefined &&
        clientName === undefined &&
        items === undefined &&
        paymentTerms === undefined &&
        discount === undefined &&
        discountType === undefined &&
        status === undefined &&
        expirationDate === undefined &&
        notes === undefined &&
        isExpiredOverride === undefined;

      const linkedOfferId = await clientQuotesRepo.findLinkedOfferId(idResult.value);
      if (linkedOfferId && !isIdOnlyUpdate) {
        return reply.code(409).send({ error: 'Quotes become read-only once an offer exists' });
      }

      const current = await clientQuotesRepo.findCurrentForUpdate(idResult.value);
      if (!current) {
        return reply.code(404).send({ error: 'Quote not found' });
      }
      const currentStatus = current.status;
      const existingDiscount = current.discount;
      const existingDiscountType = current.discountType;
      const hasNonStatusOrIdUpdates =
        clientId !== undefined ||
        clientName !== undefined ||
        items !== undefined ||
        paymentTerms !== undefined ||
        discount !== undefined ||
        discountType !== undefined ||
        expirationDate !== undefined ||
        notes !== undefined ||
        isExpiredOverride !== undefined;
      if (currentStatus === 'confirmed' && hasNonStatusOrIdUpdates) {
        return reply.code(409).send({ error: 'Confirmed quotes are read-only' });
      }

      let nextIdValue: string | undefined;
      if (nextId !== undefined) {
        const nextIdResult = requireNonEmptyString(nextId, 'id');
        if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);
        nextIdValue = nextIdResult.value;
        if (await clientQuotesRepo.findIdConflict(nextIdValue, idResult.value)) {
          return reply.code(409).send({ error: 'Quote ID already exists' });
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

      let expirationDateValue = expirationDate;
      if (expirationDate !== undefined) {
        const expirationDateResult = optionalDateString(expirationDate, 'expirationDate');
        if (!expirationDateResult.ok) return badRequest(reply, expirationDateResult.message);
        expirationDateValue = expirationDateResult.value;
      }

      let discountValue = discount;
      if (discount !== undefined) {
        const discountResult = optionalLocalizedNonNegativeNumber(discount, 'discount');
        if (!discountResult.ok) return badRequest(reply, discountResult.message);
        discountValue = discountResult.value;
      }

      const discountTypeValue: 'currency' | 'percentage' | undefined =
        discountType === undefined
          ? undefined
          : discountType === 'currency'
            ? 'currency'
            : 'percentage';

      const effectiveDiscount = discountValue ?? existingDiscount;
      const isRestore = status === 'quoted' && isExpiredOverride === false;

      if (isRestore) {
        if (await clientQuotesRepo.findNonDraftLinkedSale(idResult.value)) {
          return reply.code(409).send({
            error: 'Restore is only possible when linked sale orders are in draft status',
          });
        }
        await clientQuotesRepo.deleteDraftSalesForQuote(idResult.value);
      }

      if (status === 'quoted') {
        if (await clientQuotesRepo.findAnyLinkedSale(idResult.value)) {
          return reply.code(409).send({ error: 'Cannot revert quote with existing sale orders' });
        }
      }

      let normalizedItems: ResolvedQuoteItem[] | null = null;
      if (items !== undefined) {
        if (!Array.isArray(items) || items.length === 0) {
          return badRequest(reply, 'Items must be a non-empty array');
        }
        const itemsResult = normalizeQuoteItems(items);
        if (!itemsResult.ok) return badRequest(reply, itemsResult.message);
        const incomingItems = itemsResult.items;

        const existingSnapshots = await clientQuotesRepo.findItemSnapshotsForQuote(idResult.value);
        const existingItemsById = new Map<string, IncomingQuoteItem & QuoteItemSnapshot>();
        for (const snap of existingSnapshots) {
          existingItemsById.set(snap.id, {
            id: snap.id,
            productId: snap.productId,
            productName: '',
            quantity: 0,
            unitPrice: 0,
            discount: 0,
            productCost: snap.productCost,
            productMolPercentage: snap.productMolPercentage,
            supplierQuoteId: snap.supplierQuoteId,
            supplierQuoteItemId: snap.supplierQuoteItemId,
            supplierQuoteSupplierName: snap.supplierQuoteSupplierName,
            supplierQuoteUnitPrice: snap.supplierQuoteUnitPrice,
            unitType: snap.unitType,
          });
        }

        try {
          normalizedItems = await resolveQuoteItemSnapshots(incomingItems, existingItemsById);
        } catch (err) {
          return badRequest(reply, (err as Error).message);
        }

        const effectiveDiscountType = discountTypeValue ?? existingDiscountType;
        const totals = calculateQuoteTotals(
          normalizedItems,
          effectiveDiscount as number,
          effectiveDiscountType,
        );
        if (!Number.isFinite(totals.total) || totals.total <= 0) {
          return badRequest(reply, 'Total must be greater than 0');
        }
      } else if (discount !== undefined) {
        const itemTotals = await clientQuotesRepo.findItemTotals(idResult.value);
        const effectiveDiscountType = discountTypeValue ?? existingDiscountType;
        const totals = calculateQuoteTotals(
          itemTotals,
          effectiveDiscount as number,
          effectiveDiscountType,
        );
        if (!Number.isFinite(totals.total) || totals.total <= 0) {
          return badRequest(reply, 'Total must be greater than 0');
        }
      }

      let result: {
        quote: clientQuotesRepo.ClientQuote | null;
        items: clientQuotesRepo.ClientQuoteItem[];
      };
      try {
        result = await withDbTransaction(async (tx) => {
          // ID-only renames cascade through the FK and don't alter snapshot content, so we
          // skip them to keep the history clean.
          if (!isIdOnlyUpdate) {
            await snapshotPreState(idResult.value, 'update', request, tx);
          }
          const quote = await clientQuotesRepo.update(
            idResult.value,
            {
              id: nextIdValue ?? null,
              clientId: (clientIdValue as string | null | undefined) ?? null,
              clientName: (clientNameValue as string | null | undefined) ?? null,
              paymentTerms: (paymentTerms as string | null | undefined) ?? null,
              discount: (discountValue as number | null | undefined) ?? null,
              discountType: discountTypeValue ?? null,
              status: (status as string | null | undefined) ?? null,
              expirationDate: (expirationDateValue as string | null | undefined) ?? null,
              notes: (notes as string | null | undefined) ?? null,
            },
            tx,
          );
          if (!quote) return { quote: null, items: [] };
          const items = normalizedItems
            ? await clientQuotesRepo.replaceItems(
                quote.id,
                buildItemsForInsert(normalizedItems),
                tx,
              )
            : await clientQuotesRepo.findItemsForQuote(quote.id, tx);
          return { quote, items };
        });
      } catch (err) {
        const dup = getUniqueViolation(err);
        if (dup && (dup.constraint === 'quotes_pkey' || dup.detail?.includes('(id)'))) {
          return reply.code(409).send({ error: 'Quote ID already exists' });
        }
        throw err;
      }

      const updatedQuote = result.quote;
      const updatedItems = result.items;
      if (!updatedQuote) {
        return reply.code(404).send({ error: 'Quote not found' });
      }

      const updatedQuoteId = updatedQuote.id;

      const nextStatus = typeof status === 'string' ? status : updatedQuote.status;
      const didStatusChange = status !== undefined && currentStatus !== nextStatus;

      await logAudit({
        request,
        action: 'client_quote.updated',
        entityType: 'client_quote',
        entityId: updatedQuoteId,
        details: {
          targetLabel: updatedQuoteId,
          secondaryLabel: updatedQuote.clientName,
          fromValue: didStatusChange ? String(currentStatus) : undefined,
          toValue: didStatusChange ? String(nextStatus) : undefined,
        },
      });
      return {
        ...updatedQuote,
        items: updatedItems,
        isExpired:
          typeof isExpiredOverride === 'boolean'
            ? isExpiredOverride
            : isQuoteExpired(updatedQuote.status, updatedQuote.expirationDate),
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

  const quoteVersionRowSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      quoteId: { type: 'string' },
      reason: { type: 'string', enum: ['update', 'restore'] },
      createdByUserId: { type: ['string', 'null'] },
      createdAt: { type: 'number' },
    },
    required: ['id', 'quoteId', 'reason', 'createdAt'],
  } as const;

  const quoteVersionSchema = {
    type: 'object',
    properties: { ...quoteVersionRowSchema.properties, snapshot: {} },
    required: [...quoteVersionRowSchema.required, 'snapshot'],
  } as const;

  // GET /:id/versions - List versions for a quote
  fastify.get(
    '/:id/versions',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('sales.client_quotes.view'),
      ],
      schema: {
        tags: ['client-quotes'],
        summary: 'List versions for a client quote',
        params: idParamSchema,
        response: {
          200: { type: 'array', items: quoteVersionRowSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const [exists, versions] = await Promise.all([
        clientQuotesRepo.existsById(idResult.value),
        quoteVersionsRepo.listForQuote(idResult.value),
      ]);
      if (!exists) {
        return reply.code(404).send({ error: 'Quote not found' });
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
        requirePermission('sales.client_quotes.view'),
      ],
      schema: {
        tags: ['client-quotes'],
        summary: 'Get a single client quote version',
        params: versionParamSchema,
        response: {
          200: quoteVersionSchema,
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

      const version = await quoteVersionsRepo.findById(idResult.value, versionIdResult.value);
      if (!version) {
        return reply.code(404).send({ error: 'Version not found' });
      }
      return version;
    },
  );

  // POST /:id/versions/:versionId/restore - Atomic restore (snapshots current first)
  fastify.post(
    '/:id/versions/:versionId/restore',
    {
      onRequest: [requirePermission('sales.client_quotes.update')],
      schema: {
        tags: ['client-quotes'],
        summary: 'Restore a client quote to a prior version',
        params: versionParamSchema,
        response: {
          200: quoteSchema,
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

      // Independent reads — fan out, then run the gating ladder against resolved values.
      // Same read-only rules as PUT.
      const [linkedOfferId, current, nonDraftLinkedSale, version] = await Promise.all([
        clientQuotesRepo.findLinkedOfferId(idResult.value),
        clientQuotesRepo.findCurrentForUpdate(idResult.value),
        clientQuotesRepo.findNonDraftLinkedSale(idResult.value),
        quoteVersionsRepo.findById(idResult.value, versionIdResult.value),
      ]);

      if (linkedOfferId) {
        return reply.code(409).send({ error: 'Quotes become read-only once an offer exists' });
      }
      if (!current) {
        return reply.code(404).send({ error: 'Quote not found' });
      }
      if (current.status === 'confirmed') {
        return reply.code(409).send({ error: 'Confirmed quotes are read-only' });
      }
      if (nonDraftLinkedSale) {
        return reply.code(409).send({
          error: 'Restore is only possible when linked sale orders are in draft status',
        });
      }
      if (!version) {
        return reply.code(404).send({ error: 'Version not found' });
      }

      const snapshotItems: clientQuotesRepo.NewClientQuoteItem[] = version.snapshot.items.map(
        ({ quoteId: _q, ...rest }) => ({
          ...rest,
          id: generateQuoteItemId(),
          // `productId: ''` slips through the snapshot when sourced from a supplier quote;
          // the `quote_items` row needs NULL there.
          productId: rest.productId || null,
        }),
      );

      const restored = await withDbTransaction(async (tx) => {
        // Drop draft sales inside the tx — historical line items may not line up with the
        // current draft sale's row references, but if the snapshot/update later fails the
        // rollback must take the deletes with it (otherwise users lose draft orders for
        // an unchanged quote).
        await clientQuotesRepo.deleteDraftSalesForQuote(idResult.value, tx);
        // Snapshot current with reason='restore' so the just-replaced data stays recoverable.
        await snapshotPreState(idResult.value, 'restore', request, tx);

        const quote = await clientQuotesRepo.update(
          idResult.value,
          {
            clientId: version.snapshot.quote.clientId,
            clientName: version.snapshot.quote.clientName,
            paymentTerms: version.snapshot.quote.paymentTerms,
            discount: version.snapshot.quote.discount,
            discountType: version.snapshot.quote.discountType,
            status: version.snapshot.quote.status,
            expirationDate: version.snapshot.quote.expirationDate,
            notes: version.snapshot.quote.notes,
          },
          tx,
        );
        if (!quote) return { quote: null, items: [] };
        const items = await clientQuotesRepo.replaceItems(quote.id, snapshotItems, tx);
        return { quote, items };
      });

      if (!restored.quote) {
        return reply.code(404).send({ error: 'Quote not found' });
      }

      await logAudit({
        request,
        action: 'client_quote.restored',
        entityType: 'client_quote',
        entityId: restored.quote.id,
        details: {
          targetLabel: restored.quote.id,
          secondaryLabel: restored.quote.clientName,
          toValue: versionIdResult.value,
        },
      });

      return {
        ...restored.quote,
        items: restored.items,
        isExpired: isQuoteExpired(restored.quote.status, restored.quote.expirationDate),
      };
    },
  );

  // DELETE /:id - Delete quote
  fastify.delete(
    '/:id',
    {
      onRequest: [requirePermission('sales.client_quotes.delete')],
      schema: {
        tags: ['client-quotes'],
        summary: 'Delete client quote',
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

      if (await clientQuotesRepo.findLinkedOfferId(idResult.value)) {
        return reply
          .code(409)
          .send({ error: 'Cannot delete a quote once an offer has been created from it' });
      }

      const status = await clientQuotesRepo.findStatusAndClientName(idResult.value);
      if (!status) {
        return reply.code(404).send({ error: 'Quote not found' });
      }
      if (status.status === 'confirmed') {
        return reply.code(409).send({ error: 'Cannot delete a confirmed quote' });
      }

      await clientQuotesRepo.deleteById(idResult.value);

      await logAudit({
        request,
        action: 'client_quote.deleted',
        entityType: 'client_quote',
        entityId: idResult.value,
        details: {
          targetLabel: idResult.value,
          secondaryLabel: status.clientName ?? '',
        },
      });
      return reply.code(204).send();
    },
  );
}
