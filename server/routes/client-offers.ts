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
    productTaxRate: { type: 'number' },
    productMolPercentage: { type: ['number', 'null'] },
    specialBidUnitPrice: { type: ['number', 'null'] },
    specialBidMolPercentage: { type: ['number', 'null'] },
    note: { type: ['string', 'null'] },
    discount: { type: 'number' },
  },
  required: [
    'id',
    'offerId',
    'productName',
    'quantity',
    'unitPrice',
    'productCost',
    'productTaxRate',
    'discount',
  ],
} as const;

const offerSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    offerCode: { type: 'string' },
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
    'offerCode',
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
    productTaxRate: { type: 'number' },
    productMolPercentage: { type: 'number' },
    specialBidUnitPrice: { type: 'number' },
    specialBidMolPercentage: { type: 'number' },
    discount: { type: 'number' },
    note: { type: 'string' },
  },
  required: ['productName', 'quantity', 'unitPrice'],
} as const;

const offerCreateBodySchema = {
  type: 'object',
  properties: {
    offerCode: { type: 'string' },
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
  required: ['offerCode', 'linkedQuoteId', 'clientId', 'clientName', 'items', 'expirationDate'],
} as const;

const offerUpdateBodySchema = {
  type: 'object',
  properties: {
    offerCode: { type: 'string' },
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
  productTaxRate?: string | number;
  productMolPercentage?: string | number | null;
  specialBidUnitPrice?: string | number | null;
  specialBidMolPercentage?: string | number | null;
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
      discount: itemDiscountResult.value || 0,
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
      onRequest: [requirePermission('sales.client_offers.view')],
      schema: {
        tags: ['client-offers'],
        summary: 'List client offers',
        response: {
          200: { type: 'array', items: offerSchema },
          ...standardErrorResponses,
        },
      },
    },
    async () => {
      const offersResult = await query(
        `SELECT
            id,
            offer_code as "offerCode",
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
            product_tax_rate as "productTaxRate",
            product_mol_percentage as "productMolPercentage",
            special_bid_unit_price as "specialBidUnitPrice",
            special_bid_mol_percentage as "specialBidMolPercentage",
            note,
            discount
         FROM customer_offer_items
         ORDER BY created_at ASC`,
      );

      const itemsByOffer: Record<string, unknown[]> = {};
      itemsResult.rows.forEach((item: { offerId: string }) => {
        if (!itemsByOffer[item.offerId]) {
          itemsByOffer[item.offerId] = [];
        }
        itemsByOffer[item.offerId].push(item);
      });

      return offersResult.rows.map((offer: { id: string }) => ({
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
        offerCode,
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
        offerCode: unknown;
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

      const offerCodeResult = requireNonEmptyString(offerCode, 'offerCode');
      if (!offerCodeResult.ok) return badRequest(reply, offerCodeResult.message);
      const linkedQuoteIdResult = requireNonEmptyString(linkedQuoteId, 'linkedQuoteId');
      if (!linkedQuoteIdResult.ok) return badRequest(reply, linkedQuoteIdResult.message);
      const clientIdResult = requireNonEmptyString(clientId, 'clientId');
      if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);
      const clientNameResult = requireNonEmptyString(clientName, 'clientName');
      if (!clientNameResult.ok) return badRequest(reply, clientNameResult.message);
      if (!Array.isArray(items) || items.length === 0) {
        return badRequest(reply, 'Items must be a non-empty array');
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

      const offerId = 'co-' + Date.now();
      let createdOfferResult;
      try {
        createdOfferResult = await query(
          `INSERT INTO customer_offers
            (id, offer_code, linked_quote_id, client_id, client_name, payment_terms, discount, status, expiration_date, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING
              id,
              offer_code as "offerCode",
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
            offerId,
            offerCodeResult.value,
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
        if (error.code === '23505' && error.detail?.includes('offer_code')) {
          return reply.code(409).send({ error: 'Offer code already exists' });
        }
        throw err;
      }

      const createdItems: unknown[] = [];
      for (const item of normalizedItems) {
        const itemId = 'coi-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
        const itemResult = await query(
          `INSERT INTO customer_offer_items
            (id, offer_id, product_id, product_name, special_bid_id, quantity, unit_price, product_cost, product_tax_rate, product_mol_percentage, special_bid_unit_price, special_bid_mol_percentage, discount, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           RETURNING
             id,
             offer_id as "offerId",
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
            offerId,
            item.productId,
            item.productName,
            item.specialBidId,
            item.quantity,
            item.unitPrice,
            item.productCost,
            item.productTaxRate,
            item.productMolPercentage,
            item.specialBidUnitPrice,
            item.specialBidMolPercentage,
            item.discount,
            item.note,
          ],
        );
        createdItems.push(itemResult.rows[0]);
      }

      return reply.code(201).send({
        ...createdOfferResult.rows[0],
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
        offerCode,
        clientId,
        clientName,
        items,
        paymentTerms,
        discount,
        status,
        expirationDate,
        notes,
      } = request.body as {
        offerCode?: unknown;
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

      const isStatusChangeOnly =
        status !== undefined &&
        offerCode === undefined &&
        clientId === undefined &&
        clientName === undefined &&
        items === undefined &&
        paymentTerms === undefined &&
        discount === undefined &&
        expirationDate === undefined &&
        notes === undefined;
      if (existingOffer.status !== 'draft' && !isStatusChangeOnly) {
        return reply.code(409).send({
          error: 'Non-draft offers are read-only',
          currentStatus: existingOffer.status,
        });
      }

      let offerCodeValue = offerCode;
      if (offerCode !== undefined) {
        const offerCodeResult = optionalNonEmptyString(offerCode, 'offerCode');
        if (!offerCodeResult.ok) return badRequest(reply, offerCodeResult.message);
        offerCodeValue = offerCodeResult.value;
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

      let updatedOfferResult;
      try {
        updatedOfferResult = await query(
          `UPDATE customer_offers
           SET offer_code = COALESCE($1, offer_code),
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
              offer_code as "offerCode",
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
            offerCodeValue,
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
        if (error.code === '23505' && error.detail?.includes('offer_code')) {
          return reply.code(409).send({ error: 'Offer code already exists' });
        }
        throw err;
      }

      if (updatedOfferResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Offer not found' });
      }

      let updatedItems: unknown[] = [];
      if (items !== undefined) {
        if (!Array.isArray(items) || items.length === 0) {
          return badRequest(reply, 'Items must be a non-empty array');
        }
        const normalizedItems = normalizeItems(items, reply);
        if (!normalizedItems) return;
        await query('DELETE FROM customer_offer_items WHERE offer_id = $1', [idResult.value]);
        for (const item of normalizedItems) {
          const itemId = 'coi-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
          const itemResult = await query(
            `INSERT INTO customer_offer_items
              (id, offer_id, product_id, product_name, special_bid_id, quantity, unit_price, product_cost, product_tax_rate, product_mol_percentage, special_bid_unit_price, special_bid_mol_percentage, discount, note)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING
               id,
               offer_id as "offerId",
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
              item.specialBidId,
              item.quantity,
              item.unitPrice,
              item.productCost,
              item.productTaxRate,
              item.productMolPercentage,
              item.specialBidUnitPrice,
              item.specialBidMolPercentage,
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
              offer_id as "offerId",
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
           FROM customer_offer_items
           WHERE offer_id = $1`,
          [idResult.value],
        );
        updatedItems = itemsResult.rows;
      }

      return {
        ...updatedOfferResult.rows[0],
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

      const offerResult = await query('SELECT id, status FROM customer_offers WHERE id = $1', [
        idResult.value,
      ]);
      if (offerResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Offer not found' });
      }
      if (offerResult.rows[0].status !== 'draft') {
        return reply.code(409).send({ error: 'Only draft offers can be deleted' });
      }

      await query('DELETE FROM customer_offers WHERE id = $1', [idResult.value]);
      return reply.code(204).send();
    },
  );
}
