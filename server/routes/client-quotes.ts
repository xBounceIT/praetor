import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { isPastLocalDate, normalizeNullableDateOnly } from '../utils/date.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
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

interface DatabaseError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
}

type IncomingQuoteItem = {
  id?: string;
  productId: string;
  productName: string;
  specialBidId?: string | null;
  supplierQuoteItemId?: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  note?: string | null;
  unitType?: UnitType;
};

type UnitType = 'hours' | 'days' | 'unit';

type QuoteItemSnapshot = {
  productCost: number;
  productMolPercentage: number | null;
  specialBidUnitPrice: number | null;
  specialBidMolPercentage: number | null;
  // Supplier quote snapshot fields
  supplierQuoteId: string | null;
  supplierQuoteItemId: string | null;
  supplierQuoteSupplierName: string | null;
  supplierQuoteUnitPrice: number | null;
  supplierQuoteItemDiscount: number | null;
  supplierQuoteDiscount: number | null;
};

type ResolvedQuoteItem = IncomingQuoteItem & QuoteItemSnapshot;

const normalizeNullableString = (value: unknown) => {
  if (value === undefined || value === null) return null;
  const stringValue = String(value).trim();
  return stringValue.length > 0 ? stringValue : null;
};

const normalizeSpecialBidId = (value: unknown) => normalizeNullableString(value);

const normalizeUnitType = (value: unknown): UnitType => {
  if (value === 'days') return 'days';
  if (value === 'unit') return 'unit';
  return 'hours';
};

const normalizeQuoteItems = (
  items: unknown[],
): { ok: true; items: IncomingQuoteItem[] } | { ok: false; message: string } => {
  const result: IncomingQuoteItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as Record<string, unknown>;
    const itemSupplierQuoteItemId = normalizeNullableString(item.supplierQuoteItemId);
    if (!item.productId && !itemSupplierQuoteItemId) {
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
    result.push({
      id: normalizeNullableString(item.id) ?? undefined,
      productId: normalizeNullableString(item.productId),
      productName: productNameResult.value,
      specialBidId: normalizeSpecialBidId(item.specialBidId),
      supplierQuoteItemId: itemSupplierQuoteItemId,
      quantity: quantityResult.value,
      unitPrice: unitPriceResult.value,
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

  const discountAmount = subtotal * (normalizedGlobalDiscount / 100);
  const total = subtotal - discountAmount;
  return { total, subtotal };
};

const getProductSnapshots = async (productIds: string[]) => {
  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map<string, QuoteItemSnapshot>();

  const result = await query(
    `SELECT
        id,
        costo,
        mol_percentage as "molPercentage"
     FROM products
     WHERE id = ANY($1)`,
    [uniqueIds],
  );

  const snapshots = new Map<string, QuoteItemSnapshot>();
  result.rows.forEach((row) => {
    snapshots.set(row.id, {
      productCost: Number(row.costo ?? 0),
      productMolPercentage:
        row.molPercentage === undefined || row.molPercentage === null
          ? null
          : Number(row.molPercentage),
      specialBidUnitPrice: null,
      specialBidMolPercentage: null,
      supplierQuoteId: null,
      supplierQuoteItemId: null,
      supplierQuoteSupplierName: null,
      supplierQuoteUnitPrice: null,
      supplierQuoteItemDiscount: null,
      supplierQuoteDiscount: null,
    });
  });
  return snapshots;
};

const getSpecialBidSnapshots = async (specialBidIds: string[]) => {
  const uniqueIds = Array.from(new Set(specialBidIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return new Map<
      string,
      { productId: string; unitPrice: number; molPercentage: number | null }
    >();
  }

  const result = await query(
    `SELECT
        id,
        product_id as "productId",
        unit_price as "unitPrice",
        mol_percentage as "molPercentage"
     FROM special_bids
     WHERE id = ANY($1)`,
    [uniqueIds],
  );

  const snapshots = new Map<
    string,
    { productId: string; unitPrice: number; molPercentage: number | null }
  >();
  result.rows.forEach((row) => {
    snapshots.set(row.id, {
      productId: row.productId,
      unitPrice: Number(row.unitPrice ?? 0),
      molPercentage:
        row.molPercentage === undefined || row.molPercentage === null
          ? null
          : Number(row.molPercentage),
    });
  });
  return snapshots;
};

// New function to get supplier quote item snapshots
const getSupplierQuoteItemSnapshots = async (supplierQuoteItemIds: string[]) => {
  const uniqueIds = Array.from(new Set(supplierQuoteItemIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return new Map<
      string,
      {
        supplierQuoteId: string;
        supplierName: string;
        productId: string;
        unitPrice: number;
        itemDiscount: number;
        quoteDiscount: number;
        netCost: number;
      }
    >();
  }

  const result = await query(
    `SELECT
        sqi.id as "itemId",
        sq.id as "quoteId",
        sq.supplier_name as "supplierName",
        sqi.product_id as "productId",
        sqi.unit_price as "unitPrice",
        sqi.discount as "itemDiscount",
        sq.discount as "quoteDiscount"
     FROM supplier_quote_items sqi
     JOIN supplier_quotes sq ON sq.id = sqi.quote_id
     WHERE sqi.id = ANY($1) AND sq.status = 'accepted'`,
    [uniqueIds],
  );

  const snapshots = new Map<
    string,
    {
      supplierQuoteId: string;
      supplierName: string;
      productId: string;
      unitPrice: number;
      itemDiscount: number;
      quoteDiscount: number;
      netCost: number;
    }
  >();
  result.rows.forEach((row) => {
    // Calculate net cost after discounts
    const lineDiscountedCost =
      Number(row.unitPrice ?? 0) * (1 - Number(row.itemDiscount ?? 0) / 100);
    const netCost = lineDiscountedCost * (1 - Number(row.quoteDiscount ?? 0) / 100);

    snapshots.set(row.itemId, {
      supplierQuoteId: row.quoteId,
      supplierName: row.supplierName,
      productId: row.productId,
      unitPrice: Number(row.unitPrice ?? 0),
      itemDiscount: Number(row.itemDiscount ?? 0),
      quoteDiscount: Number(row.quoteDiscount ?? 0),
      netCost,
    });
  });
  return snapshots;
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
      normalizeSpecialBidId(existingItem.specialBidId) !==
        normalizeSpecialBidId(item.specialBidId) ||
      normalizeNullableString(existingItem.supplierQuoteItemId) !==
        normalizeNullableString(item.supplierQuoteItemId)
    );
  });

  const [productSnapshots, specialBidSnapshots, supplierQuoteSnapshots] = await Promise.all([
    getProductSnapshots(itemsNeedingRecalc.map((item) => item.productId)),
    getSpecialBidSnapshots(
      itemsNeedingRecalc
        .map((item) => normalizeSpecialBidId(item.specialBidId))
        .filter((bidId): bidId is string => bidId !== null),
    ),
    getSupplierQuoteItemSnapshots(
      itemsNeedingRecalc
        .map((item) => normalizeNullableString(item.supplierQuoteItemId))
        .filter((id): id is string => id !== null),
    ),
  ]);

  const resolvedItems: ResolvedQuoteItem[] = [];
  for (const item of items) {
    const normalizedBidId = normalizeSpecialBidId(item.specialBidId);
    const normalizedSupplierQuoteItemId = normalizeNullableString(item.supplierQuoteItemId);

    // Validate: cannot have both special bid and supplier quote
    if (normalizedBidId && normalizedSupplierQuoteItemId) {
      throw new Error(`Item cannot have both specialBidId and supplierQuoteItemId`);
    }

    if (existingItemsById && item.id) {
      const existingItem = existingItemsById.get(item.id);
      const isUnchanged =
        existingItem &&
        existingItem.productId === item.productId &&
        normalizeSpecialBidId(existingItem.specialBidId) === normalizedBidId &&
        normalizeNullableString(existingItem.supplierQuoteItemId) === normalizedSupplierQuoteItemId;
      if (existingItem && isUnchanged) {
        resolvedItems.push({
          ...item,
          specialBidId: normalizedBidId,
          supplierQuoteItemId: normalizedSupplierQuoteItemId,
          productCost: existingItem.productCost,
          productMolPercentage: existingItem.productMolPercentage ?? null,
          specialBidUnitPrice: existingItem.specialBidUnitPrice ?? null,
          specialBidMolPercentage: existingItem.specialBidMolPercentage ?? null,
          supplierQuoteId: existingItem.supplierQuoteId ?? null,
          supplierQuoteSupplierName: existingItem.supplierQuoteSupplierName ?? null,
          supplierQuoteUnitPrice: existingItem.supplierQuoteUnitPrice ?? null,
          supplierQuoteItemDiscount: existingItem.supplierQuoteItemDiscount ?? null,
          supplierQuoteDiscount: existingItem.supplierQuoteDiscount ?? null,
        });
        continue;
      }
    }

    const productSnapshot = item.productId ? productSnapshots.get(item.productId) : undefined;
    if (!productSnapshot && !normalizedSupplierQuoteItemId) {
      throw new Error(`items productId "${item.productId}" is invalid`);
    }

    let specialBidUnitPrice: number | null = null;
    let specialBidMolPercentage: number | null = null;
    // Supplier quote snapshot fields
    let supplierQuoteId: string | null = null;
    let supplierQuoteSupplierName: string | null = null;
    let supplierQuoteUnitPrice: number | null = null;
    let supplierQuoteItemDiscount: number | null = null;
    let supplierQuoteDiscount: number | null = null;

    if (normalizedBidId) {
      const specialBidSnapshot = specialBidSnapshots.get(normalizedBidId);
      if (!specialBidSnapshot) {
        throw new Error(`specialBidId "${normalizedBidId}" is invalid`);
      }
      if (specialBidSnapshot.productId !== item.productId) {
        throw new Error(
          `specialBidId "${normalizedBidId}" does not match productId "${item.productId}"`,
        );
      }
      specialBidUnitPrice = specialBidSnapshot.unitPrice;
      specialBidMolPercentage = specialBidSnapshot.molPercentage;
    }

    if (normalizedSupplierQuoteItemId) {
      const supplierQuoteSnapshot = supplierQuoteSnapshots.get(normalizedSupplierQuoteItemId);
      if (!supplierQuoteSnapshot) {
        throw new Error(
          `supplierQuoteItemId "${normalizedSupplierQuoteItemId}" is invalid or supplier quote is not accepted`,
        );
      }
      if (
        supplierQuoteSnapshot.productId !== item.productId &&
        supplierQuoteSnapshot.productId !== null
      ) {
        throw new Error(
          `supplierQuoteItemId "${normalizedSupplierQuoteItemId}" does not match productId "${item.productId}"`,
        );
      }
      supplierQuoteId = supplierQuoteSnapshot.supplierQuoteId;
      supplierQuoteSupplierName = supplierQuoteSnapshot.supplierName;
      supplierQuoteUnitPrice = supplierQuoteSnapshot.netCost;
      supplierQuoteItemDiscount = supplierQuoteSnapshot.itemDiscount;
      supplierQuoteDiscount = supplierQuoteSnapshot.quoteDiscount;
    }

    resolvedItems.push({
      ...item,
      specialBidId: normalizedBidId,
      supplierQuoteItemId: normalizedSupplierQuoteItemId,
      productCost: productSnapshot?.productCost ?? 0,
      productMolPercentage: productSnapshot?.productMolPercentage ?? null,
      specialBidUnitPrice,
      specialBidMolPercentage,
      supplierQuoteId,
      supplierQuoteSupplierName,
      supplierQuoteUnitPrice,
      supplierQuoteItemDiscount,
      supplierQuoteDiscount,
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
    specialBidId: { type: ['string', 'null'] },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    productCost: { type: 'number' },
    productMolPercentage: { type: ['number', 'null'] },
    specialBidUnitPrice: { type: ['number', 'null'] },
    specialBidMolPercentage: { type: ['number', 'null'] },
    // Supplier quote fields
    supplierQuoteId: { type: ['string', 'null'] },
    supplierQuoteItemId: { type: ['string', 'null'] },
    supplierQuoteSupplierName: { type: ['string', 'null'] },
    supplierQuoteUnitPrice: { type: ['number', 'null'] },
    supplierQuoteItemDiscount: { type: ['number', 'null'] },
    supplierQuoteDiscount: { type: ['number', 'null'] },
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
    specialBidId: { type: 'string' },
    supplierQuoteItemId: { type: 'string' },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    productCost: { type: 'number' },
    productMolPercentage: { type: 'number' },
    specialBidUnitPrice: { type: 'number' },
    specialBidMolPercentage: { type: 'number' },
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
    status: { type: 'string' },
    expirationDate: { type: 'string', format: 'date' },
    notes: { type: 'string' },
    isExpired: { type: 'boolean' },
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

const normalizeQuoteItemRow = (row: Record<string, unknown>) => ({
  id: String(row.id),
  quoteId: String(row.quoteId),
  productId: String(row.productId),
  productName: String(row.productName),
  specialBidId: toNullableString(row.specialBidId),
  quantity: toFiniteNumber(row.quantity, 'quoteItem.quantity'),
  unitPrice: toFiniteNumber(row.unitPrice, 'quoteItem.unitPrice'),
  productCost: toFiniteNumber(row.productCost, 'quoteItem.productCost'),
  productMolPercentage: toNullableFiniteNumber(
    row.productMolPercentage,
    'quoteItem.productMolPercentage',
  ),
  specialBidUnitPrice: toNullableFiniteNumber(
    row.specialBidUnitPrice,
    'quoteItem.specialBidUnitPrice',
  ),
  specialBidMolPercentage: toNullableFiniteNumber(
    row.specialBidMolPercentage,
    'quoteItem.specialBidMolPercentage',
  ),
  // Supplier quote fields
  supplierQuoteId: toNullableString(row.supplierQuoteId),
  supplierQuoteItemId: toNullableString(row.supplierQuoteItemId),
  supplierQuoteSupplierName: toNullableString(row.supplierQuoteSupplierName),
  supplierQuoteUnitPrice: toNullableFiniteNumber(
    row.supplierQuoteUnitPrice,
    'quoteItem.supplierQuoteUnitPrice',
  ),
  supplierQuoteItemDiscount: toNullableFiniteNumber(
    row.supplierQuoteItemDiscount,
    'quoteItem.supplierQuoteItemDiscount',
  ),
  supplierQuoteDiscount: toNullableFiniteNumber(
    row.supplierQuoteDiscount,
    'quoteItem.supplierQuoteDiscount',
  ),
  discount: toFiniteNumber(row.discount, 'quoteItem.discount'),
  note: toNullableString(row.note),
  unitType: normalizeUnitType(row.unitType),
});

const normalizeQuoteRow = (row: Record<string, unknown>) => ({
  id: String(row.id),
  linkedOfferId: toNullableString(row.linkedOfferId),
  clientId: String(row.clientId),
  clientName: String(row.clientName),
  paymentTerms: toNullableString(row.paymentTerms),
  discount: toFiniteNumber(row.discount, 'quote.discount'),
  status: String(row.status),
  expirationDate: normalizeNullableDateOnly(row.expirationDate, 'quote.expirationDate'),
  notes: toNullableString(row.notes),
  createdAt: toFiniteNumber(row.createdAt, 'quote.createdAt'),
  updatedAt: toFiniteNumber(row.updatedAt, 'quote.updatedAt'),
});

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // All quote routes require authentication
  fastify.addHook('onRequest', authenticateToken);

  const isQuoteExpired = (status: string, expirationDate: string | null | undefined) => {
    if (status === 'confirmed') return false;
    if (!expirationDate) return false;
    return isPastLocalDate(expirationDate);
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
      // Get all quotes
      const quotesResult = await query(
        `SELECT
                id,
                (
                  SELECT co.id
                  FROM customer_offers co
                  WHERE co.linked_quote_id = quotes.id
                  LIMIT 1
                ) as "linkedOfferId",
                client_id as "clientId",
                client_name as "clientName",
                payment_terms as "paymentTerms",
                discount,
                status,
                expiration_date as "expirationDate",
                notes,
                EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
                EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"
            FROM quotes
            ORDER BY created_at DESC`,
        [],
      );

      // Get all quote items
      const itemsResult = await query(
        `SELECT
                id,
                quote_id as "quoteId",
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
                supplier_quote_item_discount as "supplierQuoteItemDiscount",
                supplier_quote_discount as "supplierQuoteDiscount",
                discount,
                note,
                unit_type as "unitType"
            FROM quote_items
            ORDER BY created_at ASC`,
        [],
      );

      const normalizedQuoteItems = itemsResult.rows.map((item) =>
        normalizeQuoteItemRow(item as Record<string, unknown>),
      );
      const normalizedQuotes = quotesResult.rows.map((quote) =>
        normalizeQuoteRow(quote as Record<string, unknown>),
      );

      // Group items by quote
      const itemsByQuote: Record<string, ReturnType<typeof normalizeQuoteItemRow>[]> = {};
      normalizedQuoteItems.forEach((item) => {
        if (!itemsByQuote[item.quoteId]) {
          itemsByQuote[item.quoteId] = [];
        }
        itemsByQuote[item.quoteId].push(item);
      });

      // Attach items to quotes
      const quotes = normalizedQuotes.map((quote) => ({
        ...quote,
        items: itemsByQuote[quote.id] || [],
        isExpired: isQuoteExpired(quote.status, quote.expirationDate),
      }));

      return quotes;
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
        status: unknown;
        expirationDate: unknown;
        notes: unknown;
      };

      const nextIdResult = requireNonEmptyString(nextId, 'id');
      if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);
      const existingQuote = await query('SELECT id FROM quotes WHERE id = $1', [
        nextIdResult.value,
      ]);
      if (existingQuote.rows.length > 0) {
        return reply.code(409).send({ error: 'Quote ID already exists' });
      }

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

      let resolvedItems: ResolvedQuoteItem[];
      try {
        resolvedItems = await resolveQuoteItemSnapshots(normalizedItems);
      } catch (err) {
        return badRequest(reply, (err as Error).message);
      }

      const totals = calculateQuoteTotals(resolvedItems, discountValue);
      if (!Number.isFinite(totals.total) || totals.total <= 0) {
        return badRequest(reply, 'Total must be greater than 0');
      }

      try {
        const quoteResult = await query(
          `INSERT INTO quotes (id, client_id, client_name, payment_terms, discount, status, expiration_date, notes)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING
                    id,
                    null::varchar as "linkedOfferId",
                    client_id as "clientId",
                    client_name as "clientName",
                    payment_terms as "paymentTerms",
                    discount,
                    status,
                    expiration_date as "expirationDate",
                    notes,
                    EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
                    EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
          [
            nextIdResult.value,
            clientIdResult.value,
            clientNameResult.value,
            paymentTerms || 'immediate',
            discountValue,
            status || 'draft',
            expirationDateResult.value,
            notes,
          ],
        );

        // Insert quote items
        const createdItems: ReturnType<typeof normalizeQuoteItemRow>[] = [];
        for (const item of resolvedItems) {
          const itemId = 'qi-' + Date.now() + '-' + Math.random().toString(36).substring(2, 11);
          const itemResult = await query(
            `INSERT INTO quote_items (
              id, quote_id, product_id, product_name, special_bid_id,
              quantity, unit_price, product_cost, product_mol_percentage,
              special_bid_unit_price, special_bid_mol_percentage, discount, note,
              supplier_quote_id, supplier_quote_item_id, supplier_quote_supplier_name,
              supplier_quote_unit_price, supplier_quote_item_discount, supplier_quote_discount,
              unit_type
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
            RETURNING
              id,
              quote_id as "quoteId",
              product_id as "productId",
              product_name as "productName",
              special_bid_id as "specialBidId",
              quantity,
              unit_price as "unitPrice",
              product_cost as "productCost",
              product_mol_percentage as "productMolPercentage",
              special_bid_unit_price as "specialBidUnitPrice",
              special_bid_mol_percentage as "specialBidMolPercentage",
              discount,
              note,
              supplier_quote_id as "supplierQuoteId",
              supplier_quote_item_id as "supplierQuoteItemId",
              supplier_quote_supplier_name as "supplierQuoteSupplierName",
              supplier_quote_unit_price as "supplierQuoteUnitPrice",
              supplier_quote_item_discount as "supplierQuoteItemDiscount",
              supplier_quote_discount as "supplierQuoteDiscount",
              unit_type as "unitType"`,
            [
              itemId,
              nextIdResult.value,
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
              item.supplierQuoteItemDiscount ?? null,
              item.supplierQuoteDiscount ?? null,
              item.unitType || 'hours',
            ],
          );
          createdItems.push(normalizeQuoteItemRow(itemResult.rows[0] as Record<string, unknown>));
        }

        const normalizedQuote = normalizeQuoteRow(quoteResult.rows[0] as Record<string, unknown>);

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
          ...normalizedQuote,
          items: createdItems,
          isExpired: isQuoteExpired(normalizedQuote.status, normalizedQuote.expirationDate),
        });
      } catch (err) {
        const databaseError = err as DatabaseError;
        if (
          databaseError.code === '23505' &&
          (databaseError.constraint === 'quotes_pkey' || databaseError.detail?.includes('(id)'))
        ) {
          return reply.code(409).send({ error: 'Quote ID already exists' });
        }
        console.error('CRITICAL ERROR creating quote:', err);
        // Return the specific error message to the frontend for debugging
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
        status === undefined &&
        expirationDate === undefined &&
        notes === undefined &&
        isExpiredOverride === undefined;

      const linkedOfferResult = await query(
        'SELECT id FROM customer_offers WHERE linked_quote_id = $1 LIMIT 1',
        [idResult.value],
      );
      if (linkedOfferResult.rows.length > 0 && !isIdOnlyUpdate) {
        return reply.code(409).send({ error: 'Quotes become read-only once an offer exists' });
      }

      const currentStatusResult = await query('SELECT status, discount FROM quotes WHERE id = $1', [
        idResult.value,
      ]);
      if (currentStatusResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Quote not found' });
      }
      const currentStatus = currentStatusResult.rows[0].status;
      const existingDiscountRaw = parseFloat(currentStatusResult.rows[0].discount || 0);
      const existingDiscount = Number.isFinite(existingDiscountRaw) ? existingDiscountRaw : 0;
      const hasNonStatusOrIdUpdates =
        clientId !== undefined ||
        clientName !== undefined ||
        items !== undefined ||
        paymentTerms !== undefined ||
        discount !== undefined ||
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

        const existingQuote = await query('SELECT id FROM quotes WHERE id = $1 AND id <> $2', [
          nextIdValue,
          idResult.value,
        ]);
        if (existingQuote.rows.length > 0) {
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

      const effectiveDiscount = discountValue ?? existingDiscount;
      const isRestore = status === 'quoted' && isExpiredOverride === false;

      if (isRestore) {
        const nonDraftSalesResult = await query(
          'SELECT id FROM sales WHERE linked_quote_id = $1 AND status <> $2 LIMIT 1',
          [idResult.value, 'draft'],
        );
        if (nonDraftSalesResult.rows.length > 0) {
          return reply.code(409).send({
            error: 'Restore is only possible when linked sale orders are in draft status',
          });
        }

        await query('DELETE FROM sales WHERE linked_quote_id = $1 AND status = $2 RETURNING id', [
          idResult.value,
          'draft',
        ]);
      }

      if (status === 'quoted') {
        const linkedSaleResult = await query(
          'SELECT id FROM sales WHERE linked_quote_id = $1 LIMIT 1',
          [idResult.value],
        );
        if (linkedSaleResult.rows.length > 0) {
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

        const existingItemsResult = await query(
          `SELECT
              id,
              product_id as "productId",
              special_bid_id as "specialBidId",
              product_cost as "productCost",
              product_mol_percentage as "productMolPercentage",
              special_bid_unit_price as "specialBidUnitPrice",
              special_bid_mol_percentage as "specialBidMolPercentage",
              supplier_quote_id as "supplierQuoteId",
              supplier_quote_item_id as "supplierQuoteItemId",
              supplier_quote_supplier_name as "supplierQuoteSupplierName",
              supplier_quote_unit_price as "supplierQuoteUnitPrice",
              supplier_quote_item_discount as "supplierQuoteItemDiscount",
              supplier_quote_discount as "supplierQuoteDiscount",
              unit_type as "unitType"
           FROM quote_items
           WHERE quote_id = $1`,

          [idResult.value],
        );
        const existingItemsById = new Map<string, IncomingQuoteItem & QuoteItemSnapshot>();
        existingItemsResult.rows.forEach((item) => {
          existingItemsById.set(item.id, {
            id: item.id,
            productId: item.productId,
            productName: '',
            specialBidId: normalizeSpecialBidId(item.specialBidId),
            quantity: 0,
            unitPrice: 0,
            discount: 0,
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
            supplierQuoteId: normalizeNullableString(item.supplierQuoteId),
            supplierQuoteItemId: normalizeNullableString(item.supplierQuoteItemId),
            supplierQuoteSupplierName: normalizeNullableString(item.supplierQuoteSupplierName),
            supplierQuoteUnitPrice:
              item.supplierQuoteUnitPrice === undefined || item.supplierQuoteUnitPrice === null
                ? null
                : Number(item.supplierQuoteUnitPrice),
            supplierQuoteItemDiscount:
              item.supplierQuoteItemDiscount === undefined ||
              item.supplierQuoteItemDiscount === null
                ? null
                : Number(item.supplierQuoteItemDiscount),
            supplierQuoteDiscount:
              item.supplierQuoteDiscount === undefined || item.supplierQuoteDiscount === null
                ? null
                : Number(item.supplierQuoteDiscount),
            unitType: normalizeUnitType(item.unitType),
          });
        });

        try {
          normalizedItems = await resolveQuoteItemSnapshots(incomingItems, existingItemsById);
        } catch (err) {
          return badRequest(reply, (err as Error).message);
        }

        const totals = calculateQuoteTotals(normalizedItems, effectiveDiscount as number);
        if (!Number.isFinite(totals.total) || totals.total <= 0) {
          return badRequest(reply, 'Total must be greater than 0');
        }
      } else if (discount !== undefined) {
        const itemsResult = await query(
          `SELECT
                    quantity,
                    unit_price as "unitPrice",
                    discount
                FROM quote_items
                WHERE quote_id = $1`,
          [idResult.value],
        );
        const itemsForTotal = itemsResult.rows.map((row) => ({
          quantity: parseFloat(row.quantity),
          unitPrice: parseFloat(row.unitPrice),
          discount: parseFloat(row.discount || 0),
        }));
        const totals = calculateQuoteTotals(itemsForTotal, effectiveDiscount as number);
        if (!Number.isFinite(totals.total) || totals.total <= 0) {
          return badRequest(reply, 'Total must be greater than 0');
        }
      }

      // Update quote
      let quoteResult: Awaited<ReturnType<typeof query>>;
      try {
        quoteResult = await query(
          `UPDATE quotes
             SET id = COALESCE($1, id),
                 client_id = COALESCE($2, client_id),
                 client_name = COALESCE($3, client_name),
                 payment_terms = COALESCE($4, payment_terms),
                 discount = COALESCE($5, discount),
                 status = COALESCE($6, status),
                 expiration_date = COALESCE($7, expiration_date),
                 notes = COALESCE($8, notes),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $9
             RETURNING
                id,
                null::varchar as "linkedOfferId",
                client_id as "clientId",
                client_name as "clientName",
                payment_terms as "paymentTerms",
                discount,
                status,
                expiration_date as "expirationDate",
                notes,
                EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
                EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
          [
            nextIdValue,
            clientIdValue,
            clientNameValue,
            paymentTerms,
            discountValue,
            status,
            expirationDateValue,
            notes,
            idResult.value,
          ],
        );
      } catch (err) {
        const databaseError = err as DatabaseError;
        if (
          databaseError.code === '23505' &&
          (databaseError.constraint === 'quotes_pkey' || databaseError.detail?.includes('(id)'))
        ) {
          return reply.code(409).send({ error: 'Quote ID already exists' });
        }
        throw err;
      }

      if (quoteResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Quote not found' });
      }

      const updatedQuoteId = String(quoteResult.rows[0].id);

      // If items are provided, update them
      let updatedItems: ReturnType<typeof normalizeQuoteItemRow>[] = [];
      if (normalizedItems) {
        // Delete existing items
        await query('DELETE FROM quote_items WHERE quote_id = $1', [updatedQuoteId]);

        // Insert new items
        for (const item of normalizedItems) {
          const itemId = 'qi-' + Date.now() + '-' + Math.random().toString(36).substring(2, 11);
          const itemResult = await query(
            `INSERT INTO quote_items (
              id, quote_id, product_id, product_name, special_bid_id,
              quantity, unit_price, product_cost, product_mol_percentage,
              special_bid_unit_price, special_bid_mol_percentage, discount, note,
              supplier_quote_id, supplier_quote_item_id, supplier_quote_supplier_name,
              supplier_quote_unit_price, supplier_quote_item_discount, supplier_quote_discount,
              unit_type
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
            RETURNING
              id,
              quote_id as "quoteId",
              product_id as "productId",
              product_name as "productName",
              special_bid_id as "specialBidId",
              quantity,
              unit_price as "unitPrice",
              product_cost as "productCost",
              product_mol_percentage as "productMolPercentage",
              special_bid_unit_price as "specialBidUnitPrice",
              special_bid_mol_percentage as "specialBidMolPercentage",
              discount,
              note,
              supplier_quote_id as "supplierQuoteId",
              supplier_quote_item_id as "supplierQuoteItemId",
              supplier_quote_supplier_name as "supplierQuoteSupplierName",
              supplier_quote_unit_price as "supplierQuoteUnitPrice",
              supplier_quote_item_discount as "supplierQuoteItemDiscount",
              supplier_quote_discount as "supplierQuoteDiscount",
              unit_type as "unitType"`,
            [
              itemId,
              updatedQuoteId,
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
              item.supplierQuoteItemDiscount ?? null,
              item.supplierQuoteDiscount ?? null,
              item.unitType || 'hours',
            ],
          );
          updatedItems.push(normalizeQuoteItemRow(itemResult.rows[0] as Record<string, unknown>));
        }
      } else {
        // Fetch existing items
        const itemsResult = await query(
          `SELECT
                    id,
                    quote_id as "quoteId",
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
                    supplier_quote_item_discount as "supplierQuoteItemDiscount",
                    supplier_quote_discount as "supplierQuoteDiscount",
                    discount,
                    note,
                    unit_type as "unitType"
                FROM quote_items
                WHERE quote_id = $1`,
          [updatedQuoteId],
        );
        updatedItems = itemsResult.rows.map((item) =>
          normalizeQuoteItemRow(item as Record<string, unknown>),
        );
      }

      const normalizedQuote = normalizeQuoteRow(quoteResult.rows[0] as Record<string, unknown>);
      const nextStatus = typeof status === 'string' ? status : normalizedQuote.status;
      const didStatusChange = status !== undefined && currentStatus !== nextStatus;

      // Invalidate client cache if quote status affects sent quotes totals
      if (didStatusChange && (currentStatus === 'sent' || nextStatus === 'sent')) {
      }

      await logAudit({
        request,
        action: 'client_quote.updated',
        entityType: 'client_quote',
        entityId: updatedQuoteId,
        details: {
          targetLabel: updatedQuoteId,
          secondaryLabel: normalizedQuote.clientName,
          fromValue: didStatusChange ? String(currentStatus) : undefined,
          toValue: didStatusChange ? String(nextStatus) : undefined,
        },
      });
      return {
        ...normalizedQuote,
        items: updatedItems,
        isExpired:
          typeof isExpiredOverride === 'boolean'
            ? isExpiredOverride
            : isQuoteExpired(normalizedQuote.status, normalizedQuote.expirationDate),
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

      const linkedOfferResult = await query(
        'SELECT id FROM customer_offers WHERE linked_quote_id = $1 LIMIT 1',
        [idResult.value],
      );
      if (linkedOfferResult.rows.length > 0) {
        return reply
          .code(409)
          .send({ error: 'Cannot delete a quote once an offer has been created from it' });
      }

      const statusResult = await query(
        'SELECT status, client_name as "clientName" FROM quotes WHERE id = $1',
        [idResult.value],
      );
      if (statusResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Quote not found' });
      }
      if (statusResult.rows[0].status === 'confirmed') {
        return reply.code(409).send({ error: 'Cannot delete a confirmed quote' });
      }

      // Items will be deleted automatically via CASCADE
      await query('DELETE FROM quotes WHERE id = $1 RETURNING id', [idResult.value]);

      await logAudit({
        request,
        action: 'client_quote.deleted',
        entityType: 'client_quote',
        entityId: idResult.value,
        details: {
          targetLabel: idResult.value,
          secondaryLabel: String(statusResult.rows[0].clientName ?? ''),
        },
      });
      return reply.code(204).send();
    },
  );
}
