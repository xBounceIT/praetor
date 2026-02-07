import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import { standardErrorResponses } from '../schemas/common.ts';
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
  productId: string;
  productName: string;
  specialBidId?: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  note?: string | null;
};

type QuoteItemSnapshot = {
  productCost: number;
  productTaxRate: number;
  productMolPercentage: number | null;
  specialBidUnitPrice: number | null;
  specialBidMolPercentage: number | null;
};

type ResolvedQuoteItem = IncomingQuoteItem & QuoteItemSnapshot;

const normalizeNullableString = (value: unknown) => {
  if (value === undefined || value === null) return null;
  const stringValue = String(value).trim();
  return stringValue.length > 0 ? stringValue : null;
};

const normalizeSpecialBidId = (value: unknown) => normalizeNullableString(value);

const calculateQuoteTotals = (
  items: Array<{ quantity: number; unitPrice: number; discount?: number; productTaxRate?: number }>,
  globalDiscount: number,
) => {
  const normalizedGlobalDiscount = Number.isFinite(globalDiscount) ? globalDiscount : 0;
  let subtotal = 0;
  let totalTax = 0;

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
        taxableAmount: Number.NaN,
        totalTax: Number.NaN,
      };
    }
    const lineSubtotal = quantity * unitPrice;
    const lineDiscount = lineSubtotal * (itemDiscount / 100);
    const lineNet = lineSubtotal - lineDiscount;
    subtotal += lineNet;

    const taxRate = Number(item.productTaxRate ?? 0);
    const lineNetAfterGlobal = lineNet * (1 - normalizedGlobalDiscount / 100);
    const taxAmount = lineNetAfterGlobal * (taxRate / 100);
    totalTax += taxAmount;
  }

  const discountAmount = subtotal * (normalizedGlobalDiscount / 100);
  const taxableAmount = subtotal - discountAmount;
  const total = taxableAmount + totalTax;
  return { total, subtotal, taxableAmount, totalTax };
};

const getProductSnapshots = async (productIds: string[]) => {
  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map<string, QuoteItemSnapshot>();

  const result = await query(
    `SELECT
        id,
        costo,
        mol_percentage as "molPercentage",
        tax_rate as "taxRate"
     FROM products
     WHERE id = ANY($1)`,
    [uniqueIds],
  );

  const snapshots = new Map<string, QuoteItemSnapshot>();
  result.rows.forEach((row) => {
    snapshots.set(row.id, {
      productCost: Number(row.costo ?? 0),
      productTaxRate: Number(row.taxRate ?? 0),
      productMolPercentage:
        row.molPercentage === undefined || row.molPercentage === null
          ? null
          : Number(row.molPercentage),
      specialBidUnitPrice: null,
      specialBidMolPercentage: null,
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
      normalizeSpecialBidId(existingItem.specialBidId) !== normalizeSpecialBidId(item.specialBidId)
    );
  });

  const productSnapshots = await getProductSnapshots(
    itemsNeedingRecalc.map((item) => item.productId),
  );
  const specialBidSnapshots = await getSpecialBidSnapshots(
    itemsNeedingRecalc
      .map((item) => normalizeSpecialBidId(item.specialBidId))
      .filter((bidId): bidId is string => bidId !== null),
  );

  const resolvedItems: ResolvedQuoteItem[] = [];
  for (const item of items) {
    const normalizedBidId = normalizeSpecialBidId(item.specialBidId);
    if (existingItemsById && item.id) {
      const existingItem = existingItemsById.get(item.id);
      const isUnchanged =
        existingItem &&
        existingItem.productId === item.productId &&
        normalizeSpecialBidId(existingItem.specialBidId) === normalizedBidId;
      if (existingItem && isUnchanged) {
        resolvedItems.push({
          ...item,
          specialBidId: normalizedBidId,
          productCost: existingItem.productCost,
          productTaxRate: existingItem.productTaxRate,
          productMolPercentage: existingItem.productMolPercentage ?? null,
          specialBidUnitPrice: existingItem.specialBidUnitPrice ?? null,
          specialBidMolPercentage: existingItem.specialBidMolPercentage ?? null,
        });
        continue;
      }
    }

    const productSnapshot = productSnapshots.get(item.productId);
    if (!productSnapshot) {
      throw new Error(`items productId "${item.productId}" is invalid`);
    }

    let specialBidUnitPrice: number | null = null;
    let specialBidMolPercentage: number | null = null;
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

    resolvedItems.push({
      ...item,
      specialBidId: normalizedBidId,
      productCost: productSnapshot.productCost,
      productTaxRate: productSnapshot.productTaxRate,
      productMolPercentage: productSnapshot.productMolPercentage,
      specialBidUnitPrice,
      specialBidMolPercentage,
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
    productTaxRate: { type: 'number' },
    productMolPercentage: { type: ['number', 'null'] },
    specialBidUnitPrice: { type: ['number', 'null'] },
    specialBidMolPercentage: { type: ['number', 'null'] },
    discount: { type: 'number' },
    note: { type: ['string', 'null'] },
  },
  required: [
    'id',
    'quoteId',
    'productId',
    'productName',
    'quantity',
    'unitPrice',
    'productCost',
    'productTaxRate',
    'discount',
  ],
} as const;

const quoteSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    quoteCode: { type: 'string' },
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
    'quoteCode',
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
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    productCost: { type: 'number' },
    productTaxRate: { type: 'number' },
    productMolPercentage: { type: 'number' },
    specialBidUnitPrice: { type: 'number' },
    specialBidMolPercentage: { type: 'number' },
    discount: { type: 'number' },
    note: { type: 'string' },
  },
  required: ['productId', 'productName', 'quantity', 'unitPrice'],
} as const;

const quoteCreateBodySchema = {
  type: 'object',
  properties: {
    quoteCode: { type: 'string' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    items: { type: 'array', items: quoteItemBodySchema },
    paymentTerms: { type: 'string' },
    discount: { type: 'number' },
    status: { type: 'string' },
    expirationDate: { type: 'string', format: 'date' },
    notes: { type: 'string' },
  },
  required: ['quoteCode', 'clientId', 'clientName', 'items', 'expirationDate'],
} as const;

const quoteUpdateBodySchema = {
  type: 'object',
  properties: {
    quoteCode: { type: 'string' },
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

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // All quote routes require authentication
  fastify.addHook('onRequest', authenticateToken);

  const isQuoteExpired = (status: string, expirationDate: string | Date | null | undefined) => {
    if (status === 'confirmed') return false;
    if (!expirationDate) return false;

    let normalizedDate: string;
    if (expirationDate instanceof Date) {
      normalizedDate = expirationDate.toISOString().split('T')[0];
    } else {
      normalizedDate = expirationDate.toString().includes('T')
        ? expirationDate.toString().split('T')[0]
        : expirationDate.toString();
    }

    const expiry = new Date(normalizedDate);
    // Set time to end of day to avoid premature expiration
    expiry.setHours(23, 59, 59, 999);
    return new Date() > expiry;
  };

  // GET / - List all quotes with their items
  fastify.get(
    '/',
    {
      onRequest: [requirePermission('sales.client_quotes.view')],
      schema: {
        tags: ['client-quotes'],
        summary: 'List client quotes',
        response: {
          200: { type: 'array', items: quoteSchema },
          ...standardErrorResponses,
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      // Get all quotes
      const quotesResult = await query(
        `SELECT
                id,
                quote_code as "quoteCode",
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
                product_tax_rate as "productTaxRate",
                product_mol_percentage as "productMolPercentage",
                special_bid_unit_price as "specialBidUnitPrice",
                special_bid_mol_percentage as "specialBidMolPercentage",
                discount,
                note
            FROM quote_items
            ORDER BY created_at ASC`,
        [],
      );

      // Group items by quote
      const itemsByQuote: Record<string, unknown[]> = {};
      itemsResult.rows.forEach((item: { quoteId: string }) => {
        if (!itemsByQuote[item.quoteId]) {
          itemsByQuote[item.quoteId] = [];
        }
        itemsByQuote[item.quoteId].push(item);
      });

      // Attach items to quotes
      const quotes = quotesResult.rows.map(
        (quote: {
          id: string;
          status: string;
          expirationDate: string | Date | null | undefined;
        }) => ({
          ...quote,
          items: itemsByQuote[quote.id] || [],
          isExpired: isQuoteExpired(quote.status, quote.expirationDate),
        }),
      );

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
        quoteCode,
        clientId,
        clientName,
        items,
        paymentTerms,
        discount,
        status,
        expirationDate,
        notes,
      } = request.body as {
        quoteCode: unknown;
        clientId: unknown;
        clientName: unknown;
        items: unknown;
        paymentTerms: unknown;
        discount: unknown;
        status: unknown;
        expirationDate: unknown;
        notes: unknown;
      };

      const quoteCodeResult = requireNonEmptyString(quoteCode, 'quoteCode');
      if (!quoteCodeResult.ok) return badRequest(reply, quoteCodeResult.message);
      const existingQuoteCode = await query('SELECT id FROM quotes WHERE quote_code = $1', [
        quoteCodeResult.value,
      ]);
      if (existingQuoteCode.rows.length > 0) {
        return reply.code(409).send({ error: 'Quote code already exists' });
      }

      const clientIdResult = requireNonEmptyString(clientId, 'clientId');
      if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);

      const clientNameResult = requireNonEmptyString(clientName, 'clientName');
      if (!clientNameResult.ok) return badRequest(reply, clientNameResult.message);

      if (!Array.isArray(items) || items.length === 0) {
        return badRequest(reply, 'Items must be a non-empty array');
      }

      const normalizedItems: IncomingQuoteItem[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i] as Record<string, unknown>;
        const productIdResult = requireNonEmptyString(item.productId, `items[${i}].productId`);
        if (!productIdResult.ok) return badRequest(reply, productIdResult.message);
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
          id: normalizeNullableString(item.id) ?? undefined,
          productId: productIdResult.value,
          productName: productNameResult.value,
          specialBidId: normalizeSpecialBidId(item.specialBidId),
          quantity: quantityResult.value,
          unitPrice: unitPriceResult.value,
          discount: itemDiscountResult.value || 0,
          note: normalizeNullableString(item.note),
        });
      }

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
        const quoteId = 'q-' + Date.now();

        // Insert quote
        const quoteResult = await query(
          `INSERT INTO quotes (id, quote_code, client_id, client_name, payment_terms, discount, status, expiration_date, notes)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING
                    id,
                    quote_code as "quoteCode",
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
            quoteId,
            quoteCodeResult.value,
            clientIdResult.value,
            clientNameResult.value,
            paymentTerms || 'immediate',
            discountValue,
            status || 'quoted',
            expirationDateResult.value,
            notes,
          ],
        );

        // Insert quote items
        const createdItems: unknown[] = [];
        for (const item of resolvedItems) {
          const itemId = 'qi-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
          const itemResult = await query(
            `INSERT INTO quote_items (id, quote_id, product_id, product_name, special_bid_id, quantity, unit_price, product_cost, product_tax_rate, product_mol_percentage, special_bid_unit_price, special_bid_mol_percentage, discount, note)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                     RETURNING
                        id,
                        quote_id as "quoteId",
                        product_id as "productId",
                        product_name as "productName",
                        special_bid_id as "specialBidId",
                        quantity,
                        unit_price as "unitPrice",
                        product_cost as "productCost",
                        product_tax_rate as "productTaxRate",
                        product_mol_percentage as "productMolPercentage",
                        special_bid_unit_price as "specialBidUnitPrice",
                        special_bid_mol_percentage as "specialBidMolPercentage",
                        discount,
                        note`,
            [
              itemId,
              quoteId,
              item.productId,
              item.productName,
              item.specialBidId || null,
              item.quantity,
              item.unitPrice,
              item.productCost,
              item.productTaxRate,
              item.productMolPercentage ?? null,
              item.specialBidUnitPrice ?? null,
              item.specialBidMolPercentage ?? null,
              item.discount || 0,
              item.note || null,
            ],
          );
          createdItems.push(itemResult.rows[0]);
        }

        return reply.code(201).send({
          ...quoteResult.rows[0],
          items: createdItems,
          isExpired: isQuoteExpired(quoteResult.rows[0].status, quoteResult.rows[0].expirationDate),
        });
      } catch (err) {
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
        quoteCode,
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
        quoteCode: unknown;
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

      const currentStatusResult = await query('SELECT status, discount FROM quotes WHERE id = $1', [
        idResult.value,
      ]);
      if (currentStatusResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Quote not found' });
      }
      const currentStatus = currentStatusResult.rows[0].status;
      const existingDiscountRaw = parseFloat(currentStatusResult.rows[0].discount || 0);
      const existingDiscount = Number.isFinite(existingDiscountRaw) ? existingDiscountRaw : 0;
      const hasNonStatusUpdates =
        clientId !== undefined ||
        clientName !== undefined ||
        items !== undefined ||
        paymentTerms !== undefined ||
        discount !== undefined ||
        expirationDate !== undefined ||
        notes !== undefined ||
        quoteCode !== undefined;
      if (currentStatus === 'confirmed' && hasNonStatusUpdates) {
        return reply.code(409).send({ error: 'Confirmed quotes are read-only' });
      }

      let quoteCodeValue: string | undefined;
      if (quoteCode !== undefined) {
        const quoteCodeResult = requireNonEmptyString(quoteCode, 'quoteCode');
        if (!quoteCodeResult.ok) return badRequest(reply, quoteCodeResult.message);
        quoteCodeValue = quoteCodeResult.value;

        const existingQuoteCode = await query(
          'SELECT id FROM quotes WHERE quote_code = $1 AND id <> $2',
          [quoteCodeValue, idResult.value],
        );
        if (existingQuoteCode.rows.length > 0) {
          return reply.code(409).send({ error: 'Quote code already exists' });
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
        const incomingItems: IncomingQuoteItem[] = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i] as Record<string, unknown>;
          const productIdResult = requireNonEmptyString(item.productId, `items[${i}].productId`);
          if (!productIdResult.ok) return badRequest(reply, productIdResult.message);
          const productNameResult = requireNonEmptyString(
            item.productName,
            `items[${i}].productName`,
          );
          if (!productNameResult.ok) return badRequest(reply, productNameResult.message);
          const quantityResult = parseLocalizedPositiveNumber(
            item.quantity,
            `items[${i}].quantity`,
          );
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
          incomingItems.push({
            id: normalizeNullableString(item.id) ?? undefined,
            productId: productIdResult.value,
            productName: productNameResult.value,
            specialBidId: normalizeSpecialBidId(item.specialBidId),
            quantity: quantityResult.value,
            unitPrice: unitPriceResult.value,
            discount: itemDiscountResult.value || 0,
            note: normalizeNullableString(item.note),
          });
        }

        const existingItemsResult = await query(
          `SELECT
              id,
              product_id as "productId",
              special_bid_id as "specialBidId",
              product_cost as "productCost",
              product_tax_rate as "productTaxRate",
              product_mol_percentage as "productMolPercentage",
              special_bid_unit_price as "specialBidUnitPrice",
              special_bid_mol_percentage as "specialBidMolPercentage"
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
            productTaxRate: Number(item.productTaxRate ?? 0),
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
                    discount,
                    product_tax_rate as "productTaxRate"
                FROM quote_items
                WHERE quote_id = $1`,
          [idResult.value],
        );
        const itemsForTotal = itemsResult.rows.map((row) => ({
          quantity: parseFloat(row.quantity),
          unitPrice: parseFloat(row.unitPrice),
          discount: parseFloat(row.discount || 0),
          productTaxRate: parseFloat(row.productTaxRate || 0),
        }));
        const totals = calculateQuoteTotals(itemsForTotal, effectiveDiscount as number);
        if (!Number.isFinite(totals.total) || totals.total <= 0) {
          return badRequest(reply, 'Total must be greater than 0');
        }
      }

      // Update quote
      const quoteResult = await query(
        `UPDATE quotes
             SET quote_code = COALESCE($1, quote_code),
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
                quote_code as "quoteCode",
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
          quoteCodeValue,
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

      if (quoteResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Quote not found' });
      }

      // If items are provided, update them
      let updatedItems: unknown[] = [];
      if (normalizedItems) {
        // Delete existing items
        await query('DELETE FROM quote_items WHERE quote_id = $1', [idResult.value]);

        // Insert new items
        for (const item of normalizedItems) {
          const itemId = 'qi-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
          const itemResult = await query(
            `INSERT INTO quote_items (id, quote_id, product_id, product_name, special_bid_id, quantity, unit_price, product_cost, product_tax_rate, product_mol_percentage, special_bid_unit_price, special_bid_mol_percentage, discount, note)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                     RETURNING
                        id,
                        quote_id as "quoteId",
                        product_id as "productId",
                        product_name as "productName",
                        special_bid_id as "specialBidId",
                        quantity,
                        unit_price as "unitPrice",
                        product_cost as "productCost",
                        product_tax_rate as "productTaxRate",
                        product_mol_percentage as "productMolPercentage",
                        special_bid_unit_price as "specialBidUnitPrice",
                        special_bid_mol_percentage as "specialBidMolPercentage",
                        discount,
                        note`,
            [
              itemId,
              idResult.value,
              item.productId,
              item.productName,
              item.specialBidId || null,
              item.quantity,
              item.unitPrice,
              item.productCost,
              item.productTaxRate,
              item.productMolPercentage ?? null,
              item.specialBidUnitPrice ?? null,
              item.specialBidMolPercentage ?? null,
              item.discount || 0,
              item.note || null,
            ],
          );
          updatedItems.push(itemResult.rows[0]);
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
                    product_tax_rate as "productTaxRate",
                    product_mol_percentage as "productMolPercentage",
                    special_bid_unit_price as "specialBidUnitPrice",
                    special_bid_mol_percentage as "specialBidMolPercentage",
                    discount,
                    note
                FROM quote_items
                WHERE quote_id = $1`,
          [idResult.value],
        );
        updatedItems = itemsResult.rows;
      }

      return {
        ...quoteResult.rows[0],
        items: updatedItems,
        isExpired:
          typeof isExpiredOverride === 'boolean'
            ? isExpiredOverride
            : isQuoteExpired(quoteResult.rows[0].status, quoteResult.rows[0].expirationDate),
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

      const statusResult = await query('SELECT status FROM quotes WHERE id = $1', [idResult.value]);
      if (statusResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Quote not found' });
      }
      if (statusResult.rows[0].status === 'confirmed') {
        return reply.code(409).send({ error: 'Cannot delete a confirmed quote' });
      }

      // Items will be deleted automatically via CASCADE
      await query('DELETE FROM quotes WHERE id = $1 RETURNING id', [idResult.value]);

      return reply.code(204).send();
    },
  );
}
