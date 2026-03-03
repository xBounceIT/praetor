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
    offerId: { type: 'string' },
    productId: { type: ['string', 'null'] },
    productName: { type: 'string' },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    productTaxRate: { type: 'number' },
    discount: { type: 'number' },
    note: { type: ['string', 'null'] },
  },
  required: ['id', 'offerId', 'productName', 'quantity', 'unitPrice', 'discount'],
} as const;

const offerSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    offerCode: { type: 'string' },
    linkedQuoteId: { type: 'string' },
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    paymentTerms: { type: ['string', 'null'] },
    discount: { type: 'number' },
    status: { type: 'string' },
    expirationDate: { type: ['string', 'null'], format: 'date' },
    notes: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    items: { type: 'array', items: itemSchema },
  },
  required: [
    'id',
    'offerCode',
    'linkedQuoteId',
    'supplierId',
    'supplierName',
    'discount',
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
    productTaxRate: { type: 'number' },
    discount: { type: 'number' },
    note: { type: 'string' },
  },
  required: ['productName', 'quantity', 'unitPrice'],
} as const;

const createBodySchema = {
  type: 'object',
  properties: {
    offerCode: { type: 'string' },
    linkedQuoteId: { type: 'string' },
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    items: { type: 'array', items: itemBodySchema },
    paymentTerms: { type: 'string' },
    discount: { type: 'number' },
    status: { type: 'string' },
    expirationDate: { type: 'string', format: 'date' },
    notes: { type: 'string' },
  },
  required: ['offerCode', 'linkedQuoteId', 'supplierId', 'supplierName', 'items', 'expirationDate'],
} as const;

const updateBodySchema = {
  type: 'object',
  properties: {
    offerCode: { type: 'string' },
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    items: { type: 'array', items: itemBodySchema },
    paymentTerms: { type: 'string' },
    discount: { type: 'number' },
    status: { type: 'string' },
    expirationDate: { type: 'string', format: 'date' },
    notes: { type: 'string' },
  },
} as const;

type SupplierOfferItemInput = {
  productId?: string;
  productName?: string;
  quantity?: string | number;
  unitPrice?: string | number;
  productTaxRate?: string | number;
  discount?: string | number;
  note?: string;
};

const normalizeItems = (items: SupplierOfferItemInput[], reply: FastifyReply) => {
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
    const taxRateResult = optionalLocalizedNonNegativeNumber(
      item.productTaxRate,
      `items[${i}].productTaxRate`,
    );
    if (!taxRateResult.ok) {
      badRequest(reply, taxRateResult.message);
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
      productId: item.productId || null,
      productName: productNameResult.value,
      quantity: quantityResult.value,
      unitPrice: unitPriceResult.value,
      productTaxRate: taxRateResult.value || 0,
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
      onRequest: [requirePermission('sales.supplier_offers.view')],
      schema: {
        tags: ['supplier-offers'],
        summary: 'List supplier offers',
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
            supplier_id as "supplierId",
            supplier_name as "supplierName",
            payment_terms as "paymentTerms",
            discount,
            status,
            expiration_date as "expirationDate",
            notes,
            EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
            EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"
         FROM supplier_offers
         ORDER BY created_at DESC`,
      );

      const itemsResult = await query(
        `SELECT
            id,
            offer_id as "offerId",
            product_id as "productId",
            product_name as "productName",
            quantity,
            unit_price as "unitPrice",
            product_tax_rate as "productTaxRate",
            discount,
            note
         FROM supplier_offer_items
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
      onRequest: [requirePermission('sales.supplier_offers.create')],
      schema: {
        tags: ['supplier-offers'],
        summary: 'Create supplier offer',
        body: createBodySchema,
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
        supplierId,
        supplierName,
        items,
        paymentTerms,
        discount,
        status,
        expirationDate,
        notes,
      } = request.body as {
        offerCode: unknown;
        linkedQuoteId: unknown;
        supplierId: unknown;
        supplierName: unknown;
        items: SupplierOfferItemInput[] | unknown;
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
      const supplierIdResult = requireNonEmptyString(supplierId, 'supplierId');
      if (!supplierIdResult.ok) return badRequest(reply, supplierIdResult.message);
      const supplierNameResult = requireNonEmptyString(supplierName, 'supplierName');
      if (!supplierNameResult.ok) return badRequest(reply, supplierNameResult.message);
      if (!Array.isArray(items) || items.length === 0) {
        return badRequest(reply, 'Items must be a non-empty array');
      }

      const quoteResult = await query('SELECT id, status FROM supplier_quotes WHERE id = $1', [
        linkedQuoteIdResult.value,
      ]);
      if (quoteResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Source quote not found' });
      }
      if (quoteResult.rows[0].status !== 'accepted' && quoteResult.rows[0].status !== 'approved') {
        return reply.code(409).send({ error: 'Offers can only be created from accepted quotes' });
      }

      const existingOfferResult = await query(
        'SELECT id FROM supplier_offers WHERE linked_quote_id = $1 LIMIT 1',
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

      const offerId = 'so-' + Date.now();
      const createdOfferResult = await query(
        `INSERT INTO supplier_offers
          (id, offer_code, linked_quote_id, supplier_id, supplier_name, payment_terms, discount, status, expiration_date, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING
            id,
            offer_code as "offerCode",
            linked_quote_id as "linkedQuoteId",
            supplier_id as "supplierId",
            supplier_name as "supplierName",
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
          supplierIdResult.value,
          supplierNameResult.value,
          paymentTerms || 'immediate',
          discountResult.value || 0,
          status || 'draft',
          expirationDateResult.value,
          notes,
        ],
      );

      const createdItems: unknown[] = [];
      for (const item of normalizedItems) {
        const itemId = 'soi-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
        const itemResult = await query(
          `INSERT INTO supplier_offer_items
            (id, offer_id, product_id, product_name, quantity, unit_price, product_tax_rate, discount, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING
             id,
             offer_id as "offerId",
             product_id as "productId",
             product_name as "productName",
             quantity,
             unit_price as "unitPrice",
             product_tax_rate as "productTaxRate",
             discount,
             note`,
          [
            itemId,
            offerId,
            item.productId,
            item.productName,
            item.quantity,
            item.unitPrice,
            item.productTaxRate,
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
      onRequest: [requirePermission('sales.supplier_offers.update')],
      schema: {
        tags: ['supplier-offers'],
        summary: 'Update supplier offer',
        params: idParamSchema,
        body: updateBodySchema,
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
        supplierId,
        supplierName,
        items,
        paymentTerms,
        discount,
        status,
        expirationDate,
        notes,
      } = request.body as {
        offerCode?: unknown;
        supplierId?: unknown;
        supplierName?: unknown;
        items?: SupplierOfferItemInput[] | unknown;
        paymentTerms?: unknown;
        discount?: unknown;
        status?: unknown;
        expirationDate?: unknown;
        notes?: unknown;
      };

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const existingOfferResult = await query(
        'SELECT id, status FROM supplier_offers WHERE id = $1',
        [idResult.value],
      );
      if (existingOfferResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Offer not found' });
      }

      const isStatusChangeOnly =
        status !== undefined &&
        offerCode === undefined &&
        supplierId === undefined &&
        supplierName === undefined &&
        items === undefined &&
        paymentTerms === undefined &&
        discount === undefined &&
        expirationDate === undefined &&
        notes === undefined;
      if (existingOfferResult.rows[0].status !== 'draft' && !isStatusChangeOnly) {
        return reply.code(409).send({
          error: 'Non-draft offers are read-only',
          currentStatus: existingOfferResult.rows[0].status,
        });
      }

      let offerCodeValue = offerCode;
      if (offerCode !== undefined) {
        const offerCodeResult = optionalNonEmptyString(offerCode, 'offerCode');
        if (!offerCodeResult.ok) return badRequest(reply, offerCodeResult.message);
        offerCodeValue = offerCodeResult.value;
      }

      let supplierIdValue = supplierId;
      if (supplierId !== undefined) {
        const supplierIdResult = optionalNonEmptyString(supplierId, 'supplierId');
        if (!supplierIdResult.ok) return badRequest(reply, supplierIdResult.message);
        supplierIdValue = supplierIdResult.value;
      }

      let supplierNameValue = supplierName;
      if (supplierName !== undefined) {
        const supplierNameResult = optionalNonEmptyString(supplierName, 'supplierName');
        if (!supplierNameResult.ok) return badRequest(reply, supplierNameResult.message);
        supplierNameValue = supplierNameResult.value;
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

      const updatedOfferResult = await query(
        `UPDATE supplier_offers
         SET offer_code = COALESCE($1, offer_code),
             supplier_id = COALESCE($2, supplier_id),
             supplier_name = COALESCE($3, supplier_name),
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
            supplier_id as "supplierId",
            supplier_name as "supplierName",
            payment_terms as "paymentTerms",
            discount,
            status,
            expiration_date as "expirationDate",
            notes,
            EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
            EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
        [
          offerCodeValue,
          supplierIdValue,
          supplierNameValue,
          paymentTerms,
          discountValue,
          status,
          expirationDateValue,
          notes,
          idResult.value,
        ],
      );

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
        await query('DELETE FROM supplier_offer_items WHERE offer_id = $1', [idResult.value]);
        for (const item of normalizedItems) {
          const itemId = 'soi-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
          const itemResult = await query(
            `INSERT INTO supplier_offer_items
              (id, offer_id, product_id, product_name, quantity, unit_price, product_tax_rate, discount, note)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING
               id,
               offer_id as "offerId",
               product_id as "productId",
               product_name as "productName",
               quantity,
               unit_price as "unitPrice",
               product_tax_rate as "productTaxRate",
               discount,
               note`,
            [
              itemId,
              idResult.value,
              item.productId,
              item.productName,
              item.quantity,
              item.unitPrice,
              item.productTaxRate,
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
              quantity,
              unit_price as "unitPrice",
              product_tax_rate as "productTaxRate",
              discount,
              note
           FROM supplier_offer_items
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
      onRequest: [requirePermission('sales.supplier_offers.delete')],
      schema: {
        tags: ['supplier-offers'],
        summary: 'Delete supplier offer',
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
        'SELECT id FROM supplier_sales WHERE linked_offer_id = $1 LIMIT 1',
        [idResult.value],
      );
      if (linkedOrderResult.rows.length > 0) {
        return reply
          .code(409)
          .send({ error: 'Cannot delete an offer once a sale order has been created from it' });
      }

      const offerResult = await query('SELECT id, status FROM supplier_offers WHERE id = $1', [
        idResult.value,
      ]);
      if (offerResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Offer not found' });
      }
      if (offerResult.rows[0].status !== 'draft') {
        return reply.code(409).send({ error: 'Only draft offers can be deleted' });
      }

      await query('DELETE FROM supplier_offers WHERE id = $1', [idResult.value]);
      return reply.code(204).send();
    },
  );
}
