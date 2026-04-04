import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { normalizeNullableDateOnly } from '../utils/date.ts';
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

type DbQueryResult = Awaited<ReturnType<typeof query>>;

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const offerItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    offerId: { type: 'string' },
    productId: { type: ['string', 'null'] },
    productName: { type: 'string' },
    specialBidId: { type: ['string', 'null'] },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    productCost: { type: 'number' },
    productMolPercentage: { type: ['number', 'null'] },
    specialBidUnitPrice: { type: ['number', 'null'] },
    specialBidMolPercentage: { type: ['number', 'null'] },
    supplierQuoteId: { type: ['string', 'null'] },
    supplierQuoteItemId: { type: ['string', 'null'] },
    supplierQuoteSupplierName: { type: ['string', 'null'] },
    supplierQuoteUnitPrice: { type: ['number', 'null'] },
    supplierQuoteItemDiscount: { type: ['number', 'null'] },
    supplierQuoteDiscount: { type: ['number', 'null'] },
    note: { type: ['string', 'null'] },
    discount: { type: 'number' },
  },
  required: ['id', 'offerId', 'productName', 'quantity', 'unitPrice', 'productCost', 'discount'],
} as const;

const offerSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    linkedQuoteId: { type: 'string' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    paymentTerms: { type: ['string', 'null'] },
    discount: { type: 'number' },
    status: { type: 'string' },
    expirationDate: { type: ['string', 'null'], format: 'date' },
    notes: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    items: { type: 'array', items: offerItemSchema },
  },
  required: [
    'id',
    'linkedQuoteId',
    'clientId',
    'clientName',
    'discount',
    'status',
    'createdAt',
    'updatedAt',
    'items',
  ],
} as const;

const offerItemBodySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    productId: { type: 'string' },
    productName: { type: 'string' },
    specialBidId: { type: 'string' },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    productCost: { type: 'number' },
    productMolPercentage: { type: 'number' },
    specialBidUnitPrice: { type: 'number' },
    specialBidMolPercentage: { type: 'number' },
    supplierQuoteId: { type: 'string' },
    supplierQuoteItemId: { type: 'string' },
    supplierQuoteSupplierName: { type: 'string' },
    supplierQuoteUnitPrice: { type: 'number' },
    supplierQuoteItemDiscount: { type: 'number' },
    supplierQuoteDiscount: { type: 'number' },
    discount: { type: 'number' },
    note: { type: 'string' },
  },
  required: ['productName', 'quantity', 'unitPrice'],
} as const;

const offerCreateBodySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    linkedQuoteId: { type: 'string' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    items: { type: 'array', items: offerItemBodySchema },
    paymentTerms: { type: 'string' },
    discount: { type: 'number' },
    status: { type: 'string' },
    expirationDate: { type: 'string', format: 'date' },
    notes: { type: 'string' },
  },
  required: ['id', 'linkedQuoteId', 'clientId', 'clientName', 'items', 'expirationDate'],
} as const;

const offerUpdateBodySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    items: { type: 'array', items: offerItemBodySchema },
    paymentTerms: { type: 'string' },
    discount: { type: 'number' },
    status: { type: 'string' },
    expirationDate: { type: 'string', format: 'date' },
    notes: { type: 'string' },
  },
} as const;

type OfferItemInput = {
  id?: string;
  productId?: string;
  productName?: string;
  specialBidId?: string;
  quantity?: string | number;
  unitPrice?: string | number;
  productCost?: string | number;
  productMolPercentage?: string | number | null;
  specialBidUnitPrice?: string | number | null;
  specialBidMolPercentage?: string | number | null;
  supplierQuoteId?: string | null;
  supplierQuoteItemId?: string | null;
  supplierQuoteSupplierName?: string | null;
  supplierQuoteUnitPrice?: string | number | null;
  supplierQuoteItemDiscount?: string | number | null;
  supplierQuoteDiscount?: string | number | null;
  discount?: string | number;
  note?: string;
};

const normalizeItems = (items: OfferItemInput[], reply: FastifyReply) => {
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
    const itemDiscountResult = optionalLocalizedNonNegativeNumber(
      item.discount,
      `items[${i}].discount`,
    );
    if (!itemDiscountResult.ok) {
      badRequest(reply, itemDiscountResult.message);
      return null;
    }
    normalizedItems.push({
      ...item,
      productId: item.productId || null,
      productName: productNameResult.value,
      specialBidId: item.specialBidId || null,
      quantity: quantityResult.value,
      unitPrice: unitPriceResult.value,
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
      supplierQuoteId:
        item.supplierQuoteId === undefined || item.supplierQuoteId === null
          ? null
          : String(item.supplierQuoteId),
      supplierQuoteItemId:
        item.supplierQuoteItemId === undefined || item.supplierQuoteItemId === null
          ? null
          : String(item.supplierQuoteItemId),
      supplierQuoteSupplierName:
        item.supplierQuoteSupplierName === undefined || item.supplierQuoteSupplierName === null
          ? null
          : String(item.supplierQuoteSupplierName),
      supplierQuoteUnitPrice:
        item.supplierQuoteUnitPrice === undefined || item.supplierQuoteUnitPrice === null
          ? null
          : Number(item.supplierQuoteUnitPrice),
      supplierQuoteItemDiscount:
        item.supplierQuoteItemDiscount === undefined || item.supplierQuoteItemDiscount === null
          ? null
          : Number(item.supplierQuoteItemDiscount),
      supplierQuoteDiscount:
        item.supplierQuoteDiscount === undefined || item.supplierQuoteDiscount === null
          ? null
          : Number(item.supplierQuoteDiscount),
      discount: itemDiscountResult.value || 0,
      note: item.note || null,
    });
  }

  return normalizedItems;
};

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

const normalizeOfferItemRow = (row: Record<string, unknown>) => ({
  id: String(row.id),
  offerId: String(row.offerId),
  productId: toNullableString(row.productId),
  productName: String(row.productName),
  specialBidId: toNullableString(row.specialBidId),
  quantity: toFiniteNumber(row.quantity, 'offerItem.quantity'),
  unitPrice: toFiniteNumber(row.unitPrice, 'offerItem.unitPrice'),
  productCost: toFiniteNumber(row.productCost, 'offerItem.productCost'),
  productMolPercentage: toNullableFiniteNumber(
    row.productMolPercentage,
    'offerItem.productMolPercentage',
  ),
  specialBidUnitPrice: toNullableFiniteNumber(
    row.specialBidUnitPrice,
    'offerItem.specialBidUnitPrice',
  ),
  specialBidMolPercentage: toNullableFiniteNumber(
    row.specialBidMolPercentage,
    'offerItem.specialBidMolPercentage',
  ),
  supplierQuoteId: toNullableString(row.supplierQuoteId),
  supplierQuoteItemId: toNullableString(row.supplierQuoteItemId),
  supplierQuoteSupplierName: toNullableString(row.supplierQuoteSupplierName),
  supplierQuoteUnitPrice: toNullableFiniteNumber(
    row.supplierQuoteUnitPrice,
    'offerItem.supplierQuoteUnitPrice',
  ),
  supplierQuoteItemDiscount: toNullableFiniteNumber(
    row.supplierQuoteItemDiscount,
    'offerItem.supplierQuoteItemDiscount',
  ),
  supplierQuoteDiscount: toNullableFiniteNumber(
    row.supplierQuoteDiscount,
    'offerItem.supplierQuoteDiscount',
  ),
  note: toNullableString(row.note),
  discount: toFiniteNumber(row.discount, 'offerItem.discount'),
});

const normalizeOfferRow = (row: Record<string, unknown>) => ({
  id: String(row.id),
  linkedQuoteId: String(row.linkedQuoteId),
  clientId: String(row.clientId),
  clientName: String(row.clientName),
  paymentTerms: toNullableString(row.paymentTerms),
  discount: toFiniteNumber(row.discount, 'offer.discount'),
  status: String(row.status),
  expirationDate: normalizeNullableDateOnly(row.expirationDate, 'offer.expirationDate'),
  notes: toNullableString(row.notes),
  createdAt: toFiniteNumber(row.createdAt, 'offer.createdAt'),
  updatedAt: toFiniteNumber(row.updatedAt, 'offer.updatedAt'),
});

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.addHook('onRequest', authenticateToken);

  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('sales.client_offers.view'),
      ],
      schema: {
        tags: ['client-offers'],
        summary: 'List client offers',
        response: {
          200: { type: 'array', items: offerSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async () => {
      const offersResult = await query(
        `SELECT
            id,
            linked_quote_id as "linkedQuoteId",
            client_id as "clientId",
            client_name as "clientName",
            payment_terms as "paymentTerms",
            discount,
            status,
            expiration_date as "expirationDate",
            notes,
            EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
            EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"
         FROM customer_offers
         ORDER BY created_at DESC`,
      );

      const itemsResult = await query(
        `SELECT
            id,
            offer_id as "offerId",
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
            note,
            discount
         FROM customer_offer_items
         ORDER BY created_at ASC`,
      );

      const normalizedOfferItems = itemsResult.rows.map((item) =>
        normalizeOfferItemRow(item as Record<string, unknown>),
      );
      const normalizedOffers = offersResult.rows.map((offer) =>
        normalizeOfferRow(offer as Record<string, unknown>),
      );

      const itemsByOffer: Record<string, ReturnType<typeof normalizeOfferItemRow>[]> = {};
      normalizedOfferItems.forEach((item) => {
        if (!itemsByOffer[item.offerId]) {
          itemsByOffer[item.offerId] = [];
        }
        itemsByOffer[item.offerId].push(item);
      });

      return normalizedOffers.map((offer) => ({
        ...offer,
        items: itemsByOffer[offer.id] || [],
      }));
    },
  );

  fastify.post(
    '/',
    {
      onRequest: [requirePermission('sales.client_offers.create')],
      schema: {
        tags: ['client-offers'],
        summary: 'Create client offer',
        body: offerCreateBodySchema,
        response: {
          201: offerSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        id: nextId,
        linkedQuoteId,
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
        linkedQuoteId: unknown;
        clientId: unknown;
        clientName: unknown;
        items: OfferItemInput[] | unknown;
        paymentTerms: unknown;
        discount: unknown;
        status: unknown;
        expirationDate: unknown;
        notes: unknown;
      };

      const nextIdResult = requireNonEmptyString(nextId, 'id');
      if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);
      const linkedQuoteIdResult = requireNonEmptyString(linkedQuoteId, 'linkedQuoteId');
      if (!linkedQuoteIdResult.ok) return badRequest(reply, linkedQuoteIdResult.message);
      const clientIdResult = requireNonEmptyString(clientId, 'clientId');
      if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);
      const clientNameResult = requireNonEmptyString(clientName, 'clientName');
      if (!clientNameResult.ok) return badRequest(reply, clientNameResult.message);
      if (!Array.isArray(items) || items.length === 0) {
        return badRequest(reply, 'Items must be a non-empty array');
      }

      const existingIdResult = await query('SELECT id FROM customer_offers WHERE id = $1', [
        nextIdResult.value,
      ]);
      if (existingIdResult.rows.length > 0) {
        return reply.code(409).send({ error: 'Offer ID already exists' });
      }

      const quoteResult = await query('SELECT id, status FROM quotes WHERE id = $1', [
        linkedQuoteIdResult.value,
      ]);
      if (quoteResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Source quote not found' });
      }
      if (quoteResult.rows[0].status !== 'accepted') {
        return reply.code(409).send({ error: 'Offers can only be created from accepted quotes' });
      }

      const existingOfferResult = await query(
        'SELECT id FROM customer_offers WHERE linked_quote_id = $1 LIMIT 1',
        [linkedQuoteIdResult.value],
      );
      if (existingOfferResult.rows.length > 0) {
        return reply.code(409).send({ error: 'An offer already exists for this quote' });
      }

      const expirationDateResult = parseDateString(expirationDate, 'expirationDate');
      if (!expirationDateResult.ok) return badRequest(reply, expirationDateResult.message);
      const discountResult = optionalLocalizedNonNegativeNumber(discount, 'discount');
      if (!discountResult.ok) return badRequest(reply, discountResult.message);

      const normalizedItems = normalizeItems(items, reply);
      if (!normalizedItems) return;

      let createdOfferResult: DbQueryResult;
      try {
        createdOfferResult = await query(
          `INSERT INTO customer_offers
            (id, linked_quote_id, client_id, client_name, payment_terms, discount, status, expiration_date, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING
              id,
              linked_quote_id as "linkedQuoteId",
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
            linkedQuoteIdResult.value,
            clientIdResult.value,
            clientNameResult.value,
            paymentTerms || 'immediate',
            discountResult.value || 0,
            status || 'draft',
            expirationDateResult.value,
            notes,
          ],
        );
      } catch (err) {
        const error = err as DatabaseError;
        if (
          error.code === '23505' &&
          (error.constraint === 'customer_offers_pkey' || error.detail?.includes('(id)'))
        ) {
          return reply.code(409).send({ error: 'Offer ID already exists' });
        }
        throw err;
      }

      const createdItems: ReturnType<typeof normalizeOfferItemRow>[] = [];
      for (const item of normalizedItems) {
        const itemId = 'coi-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
        const itemResult = await query(
          `INSERT INTO customer_offer_items
            (id, offer_id, product_id, product_name, special_bid_id, quantity, unit_price, product_cost, product_mol_percentage, special_bid_unit_price, special_bid_mol_percentage, discount, note, supplier_quote_id, supplier_quote_item_id, supplier_quote_supplier_name, supplier_quote_unit_price, supplier_quote_item_discount, supplier_quote_discount)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
           RETURNING
             id,
             offer_id as "offerId",
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
             note`,
          [
            itemId,
            nextIdResult.value,
            item.productId,
            item.productName,
            item.specialBidId,
            item.quantity,
            item.unitPrice,
            item.productCost,
            item.productMolPercentage,
            item.specialBidUnitPrice,
            item.specialBidMolPercentage,
            item.discount,
            item.note,
            item.supplierQuoteId,
            item.supplierQuoteItemId,
            item.supplierQuoteSupplierName,
            item.supplierQuoteUnitPrice,
            item.supplierQuoteItemDiscount,
            item.supplierQuoteDiscount,
          ],
        );
        createdItems.push(normalizeOfferItemRow(itemResult.rows[0] as Record<string, unknown>));
      }

      await logAudit({
        request,
        action: 'client_offer.created',
        entityType: 'client_offer',
        entityId: nextIdResult.value,
        details: {
          targetLabel: nextIdResult.value,
          secondaryLabel: clientNameResult.value,
        },
      });
      return reply.code(201).send({
        ...normalizeOfferRow(createdOfferResult.rows[0] as Record<string, unknown>),
        items: createdItems,
      });
    },
  );

  fastify.put(
    '/:id',
    {
      onRequest: [requirePermission('sales.client_offers.update')],
      schema: {
        tags: ['client-offers'],
        summary: 'Update client offer',
        params: idParamSchema,
        body: offerUpdateBodySchema,
        response: {
          200: offerSchema,
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
      } = request.body as {
        id?: unknown;
        clientId?: unknown;
        clientName?: unknown;
        items?: OfferItemInput[] | unknown;
        paymentTerms?: unknown;
        discount?: unknown;
        status?: unknown;
        expirationDate?: unknown;
        notes?: unknown;
      };

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const existingOfferResult = await query(
        `SELECT
            id,
            linked_quote_id as "linkedQuoteId",
            client_id as "clientId",
            client_name as "clientName",
            status
         FROM customer_offers
         WHERE id = $1`,
        [idResult.value],
      );
      if (existingOfferResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Offer not found' });
      }

      const existingOffer = existingOfferResult.rows[0];

      const hasLockedFieldUpdates =
        clientId !== undefined ||
        clientName !== undefined ||
        items !== undefined ||
        paymentTerms !== undefined ||
        discount !== undefined ||
        expirationDate !== undefined ||
        notes !== undefined;
      if (existingOffer.status !== 'draft' && hasLockedFieldUpdates) {
        return reply.code(409).send({
          error: 'Non-draft offers are read-only',
          currentStatus: existingOffer.status,
        });
      }

      let nextIdValue = nextId;
      if (nextId !== undefined) {
        const nextIdResult = optionalNonEmptyString(nextId, 'id');
        if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);
        nextIdValue = nextIdResult.value;
        if (nextIdResult.value) {
          const existingIdResult = await query(
            'SELECT id FROM customer_offers WHERE id = $1 AND id <> $2',
            [nextIdResult.value, idResult.value],
          );
          if (existingIdResult.rows.length > 0) {
            return reply.code(409).send({ error: 'Offer ID already exists' });
          }
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

      if (existingOffer.linkedQuoteId) {
        const lockedFields: string[] = [];
        if (
          clientIdValue !== undefined &&
          clientIdValue !== null &&
          clientIdValue !== existingOffer.clientId
        ) {
          lockedFields.push('clientId');
        }
        if (
          clientNameValue !== undefined &&
          clientNameValue !== null &&
          clientNameValue !== existingOffer.clientName
        ) {
          lockedFields.push('clientName');
        }
        if (lockedFields.length > 0) {
          return reply.code(409).send({
            error: 'Quote-linked offer client details are read-only',
            fields: lockedFields,
          });
        }
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

      let updatedOfferResult: DbQueryResult;
      try {
        updatedOfferResult = await query(
          `UPDATE customer_offers
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
              linked_quote_id as "linkedQuoteId",
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
        const error = err as DatabaseError;
        if (
          error.code === '23505' &&
          (error.constraint === 'customer_offers_pkey' || error.detail?.includes('(id)'))
        ) {
          return reply.code(409).send({ error: 'Offer ID already exists' });
        }
        throw err;
      }

      if (updatedOfferResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Offer not found' });
      }

      const updatedOfferId = String(updatedOfferResult.rows[0].id);

      let updatedItems: ReturnType<typeof normalizeOfferItemRow>[] = [];
      if (items !== undefined) {
        if (!Array.isArray(items) || items.length === 0) {
          return badRequest(reply, 'Items must be a non-empty array');
        }
        const normalizedItems = normalizeItems(items, reply);
        if (!normalizedItems) return;
        await query('DELETE FROM customer_offer_items WHERE offer_id = $1', [updatedOfferId]);
        for (const item of normalizedItems) {
          const itemId = 'coi-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
          const itemResult = await query(
            `INSERT INTO customer_offer_items
              (id, offer_id, product_id, product_name, special_bid_id, quantity, unit_price, product_cost, product_mol_percentage, special_bid_unit_price, special_bid_mol_percentage, discount, note, supplier_quote_id, supplier_quote_item_id, supplier_quote_supplier_name, supplier_quote_unit_price, supplier_quote_item_discount, supplier_quote_discount)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
             RETURNING
               id,
               offer_id as "offerId",
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
               note`,
            [
              itemId,
              updatedOfferId,
              item.productId,
              item.productName,
              item.specialBidId,
              item.quantity,
              item.unitPrice,
              item.productCost,
              item.productMolPercentage,
              item.specialBidUnitPrice,
              item.specialBidMolPercentage,
              item.discount,
              item.note,
              item.supplierQuoteId,
              item.supplierQuoteItemId,
              item.supplierQuoteSupplierName,
              item.supplierQuoteUnitPrice,
              item.supplierQuoteItemDiscount,
              item.supplierQuoteDiscount,
            ],
          );
          updatedItems.push(normalizeOfferItemRow(itemResult.rows[0] as Record<string, unknown>));
        }
      } else {
        const itemsResult = await query(
          `SELECT
               id,
               offer_id as "offerId",
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
               note
            FROM customer_offer_items
            WHERE offer_id = $1`,
          [updatedOfferId],
        );
        updatedItems = itemsResult.rows.map((item) =>
          normalizeOfferItemRow(item as Record<string, unknown>),
        );
      }

      const nextStatus =
        typeof status === 'string'
          ? status
          : String(updatedOfferResult.rows[0].status ?? existingOffer.status);
      const didStatusChange = status !== undefined && existingOffer.status !== nextStatus;
      await logAudit({
        request,
        action: 'client_offer.updated',
        entityType: 'client_offer',
        entityId: updatedOfferId,
        details: {
          targetLabel: updatedOfferId,
          secondaryLabel: String(updatedOfferResult.rows[0].clientName ?? ''),
          fromValue: didStatusChange ? String(existingOffer.status) : undefined,
          toValue: didStatusChange ? nextStatus : undefined,
        },
      });

      return {
        ...normalizeOfferRow(updatedOfferResult.rows[0] as Record<string, unknown>),
        items: updatedItems,
      };
    },
  );

  fastify.delete(
    '/:id',
    {
      onRequest: [requirePermission('sales.client_offers.delete')],
      schema: {
        tags: ['client-offers'],
        summary: 'Delete client offer',
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

      const linkedOrderResult = await query(
        'SELECT id FROM sales WHERE linked_offer_id = $1 LIMIT 1',
        [idResult.value],
      );
      if (linkedOrderResult.rows.length > 0) {
        return reply
          .code(409)
          .send({ error: 'Cannot delete an offer once a sale order has been created from it' });
      }

      const offerResult = await query(
        'SELECT id, status, client_name as "clientName" FROM customer_offers WHERE id = $1',
        [idResult.value],
      );
      if (offerResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Offer not found' });
      }
      if (offerResult.rows[0].status !== 'draft') {
        return reply.code(409).send({ error: 'Only draft offers can be deleted' });
      }

      await logAudit({
        request,
        action: 'client_offer.deleted',
        entityType: 'client_offer',
        entityId: idResult.value,
        details: {
          targetLabel: idResult.value,
          secondaryLabel: String(offerResult.rows[0].clientName ?? ''),
        },
      });
      await query('DELETE FROM customer_offers WHERE id = $1', [idResult.value]);
      return reply.code(204).send();
    },
  );
}
