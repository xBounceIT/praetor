import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
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

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const supplierQuoteItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    quoteId: { type: 'string' },
    productId: { type: ['string', 'null'] },
    productName: { type: 'string' },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    discount: { type: 'number' },
    note: { type: ['string', 'null'] },
  },
  required: ['id', 'quoteId', 'productName', 'quantity', 'unitPrice', 'discount'],
} as const;

const supplierQuoteSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    quoteCode: { type: 'string' },
    purchaseOrderNumber: { type: 'string' },
    paymentTerms: { type: ['string', 'null'] },
    discount: { type: 'number' },
    status: { type: 'string' },
    expirationDate: { type: ['string', 'null'], format: 'date' },
    linkedOfferId: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    items: { type: 'array', items: supplierQuoteItemSchema },
  },
  required: [
    'id',
    'supplierId',
    'supplierName',
    'quoteCode',
    'purchaseOrderNumber',
    'discount',
    'status',
    'createdAt',
    'updatedAt',
    'items',
  ],
} as const;

const supplierQuoteItemBodySchema = {
  type: 'object',
  properties: {
    productId: { type: 'string' },
    productName: { type: 'string' },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    discount: { type: 'number' },
    note: { type: 'string' },
  },
  required: ['productName', 'quantity', 'unitPrice'],
} as const;

const supplierQuoteCreateBodySchema = {
  type: 'object',
  properties: {
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    quoteCode: { type: 'string' },
    purchaseOrderNumber: { type: 'string' },
    items: { type: 'array', items: supplierQuoteItemBodySchema },
    paymentTerms: { type: 'string' },
    discount: { type: 'number' },
    status: { type: 'string' },
    expirationDate: { type: 'string', format: 'date' },
    notes: { type: 'string' },
  },
  required: ['supplierId', 'supplierName', 'items', 'expirationDate'],
} as const;

const supplierQuoteUpdateBodySchema = {
  type: 'object',
  properties: {
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    quoteCode: { type: 'string' },
    purchaseOrderNumber: { type: 'string' },
    items: { type: 'array', items: supplierQuoteItemBodySchema },
    paymentTerms: { type: 'string' },
    discount: { type: 'number' },
    status: { type: 'string' },
    expirationDate: { type: 'string', format: 'date' },
    notes: { type: 'string' },
  },
} as const;

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.addHook('onRequest', authenticateToken);

  const normalizeSupplierQuoteStatus = (status: string) => {
    if (status === 'received') return 'sent';
    if (status === 'approved') return 'accepted';
    if (status === 'rejected') return 'denied';
    return status;
  };

  fastify.get(
    '/',
    {
      config: {
        rateLimit: STANDARD_ROUTE_RATE_LIMIT,
      },
      onRequest: [requirePermission('sales.supplier_quotes.view')],
      schema: {
        tags: ['supplier-quotes'],
        summary: 'List supplier quotes',
        response: {
          200: { type: 'array', items: supplierQuoteSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async () => {
      const quotesResult = await query(
        `SELECT
        id,
        supplier_id as "supplierId",
        supplier_name as "supplierName",
        COALESCE(quote_code, purchase_order_number) as "quoteCode",
        COALESCE(quote_code, purchase_order_number) as "purchaseOrderNumber",
        payment_terms as "paymentTerms",
        discount,
        status,
        expiration_date as "expirationDate",
        (
          SELECT so.id
          FROM supplier_offers so
          WHERE so.linked_quote_id = supplier_quotes.id
          LIMIT 1
        ) as "linkedOfferId",
        notes,
        EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
        EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"
       FROM supplier_quotes
       ORDER BY created_at DESC`,
      );

      const itemsResult = await query(
        `SELECT
        id,
        quote_id as "quoteId",
        product_id as "productId",
        product_name as "productName",
        quantity,
        unit_price as "unitPrice",
        discount,
        note
       FROM supplier_quote_items
       ORDER BY created_at ASC`,
      );

      const itemsByQuote: Record<string, unknown[]> = {};
      itemsResult.rows.forEach((item) => {
        const quoteId = (item as { quoteId: string }).quoteId;
        if (!itemsByQuote[quoteId]) {
          itemsByQuote[quoteId] = [];
        }
        itemsByQuote[quoteId].push(item);
      });

      return quotesResult.rows.map((quote) => ({
        ...quote,
        status: normalizeSupplierQuoteStatus((quote as { status: string }).status),
        items: itemsByQuote[quote.id] || [],
      }));
    },
  );

  fastify.post(
    '/',
    {
      onRequest: [requirePermission('sales.supplier_quotes.create')],
      schema: {
        tags: ['supplier-quotes'],
        summary: 'Create supplier quote',
        body: supplierQuoteCreateBodySchema,
        response: {
          201: supplierQuoteSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        supplierId,
        supplierName,
        quoteCode,
        purchaseOrderNumber,
        items,
        paymentTerms,
        discount,
        status,
        expirationDate,
        notes,
      } = request.body as {
        supplierId?: string;
        supplierName?: string;
        quoteCode?: string;
        purchaseOrderNumber?: string;
        items?: Array<{
          productId?: string;
          productName?: string;
          quantity?: string | number;
          unitPrice?: string | number;
          discount?: string | number;
          note?: string;
        }>;
        paymentTerms?: string;
        discount?: string | number;
        status?: string;
        expirationDate?: string;
        notes?: string;
      };

      const supplierIdResult = requireNonEmptyString(supplierId, 'supplierId');
      if (!supplierIdResult.ok) return badRequest(reply, supplierIdResult.message);

      const supplierNameResult = requireNonEmptyString(supplierName, 'supplierName');
      if (!supplierNameResult.ok) return badRequest(reply, supplierNameResult.message);

      const quoteCodeResult = requireNonEmptyString(quoteCode ?? purchaseOrderNumber, 'quoteCode');
      if (!quoteCodeResult.ok) return badRequest(reply, quoteCodeResult.message);

      if (!Array.isArray(items) || items.length === 0) {
        return badRequest(reply, 'Items must be a non-empty array');
      }

      const normalizedItems = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
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
          ...item,
          productName: productNameResult.value,
          quantity: quantityResult.value,
          unitPrice: unitPriceResult.value,
          discount: itemDiscountResult.value || 0,
        });
      }

      const expirationDateResult = parseDateString(expirationDate, 'expirationDate');
      if (!expirationDateResult.ok) return badRequest(reply, expirationDateResult.message);

      const discountResult = optionalLocalizedNonNegativeNumber(discount, 'discount');
      if (!discountResult.ok) return badRequest(reply, discountResult.message);

      const quoteId = 'sq-' + Date.now();
      const quoteResult = await query(
        `INSERT INTO supplier_quotes (
        id, supplier_id, supplier_name, quote_code, purchase_order_number, payment_terms, discount, status, expiration_date, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING
        id,
        supplier_id as "supplierId",
        supplier_name as "supplierName",
        quote_code as "quoteCode",
        purchase_order_number as "purchaseOrderNumber",
        payment_terms as "paymentTerms",
        discount,
        status,
        expiration_date as "expirationDate",
        null::varchar as "linkedOfferId",
        notes,
        EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
        EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
        [
          quoteId,
          supplierIdResult.value,
          supplierNameResult.value,
          quoteCodeResult.value,
          quoteCodeResult.value,
          paymentTerms || 'immediate',
          discountResult.value || 0,
          status || 'draft',
          expirationDateResult.value,
          notes,
        ],
      );

      const createdItems = [];
      for (const item of normalizedItems) {
        const itemId = 'sqi-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        const itemResult = await query(
          `INSERT INTO supplier_quote_items (
          id, quote_id, product_id, product_name, quantity, unit_price, discount, note
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING
          id,
          quote_id as "quoteId",
          product_id as "productId",
          product_name as "productName",
          quantity,
          unit_price as "unitPrice",
          discount,
          note`,
          [
            itemId,
            quoteId,
            item.productId,
            item.productName,
            item.quantity,
            item.unitPrice,
            item.discount || 0,
            item.note || null,
          ],
        );
        createdItems.push(itemResult.rows[0]);
      }

      return reply.code(201).send({
        ...quoteResult.rows[0],
        status: normalizeSupplierQuoteStatus(quoteResult.rows[0].status),
        items: createdItems,
      });
    },
  );

  fastify.put(
    '/:id',
    {
      onRequest: [requirePermission('sales.supplier_quotes.update')],
      schema: {
        tags: ['supplier-quotes'],
        summary: 'Update supplier quote',
        params: idParamSchema,
        body: supplierQuoteUpdateBodySchema,
        response: {
          200: supplierQuoteSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const {
        supplierId,
        supplierName,
        quoteCode,
        purchaseOrderNumber,
        items,
        paymentTerms,
        discount,
        status,
        expirationDate,
        notes,
      } = request.body as {
        supplierId?: string;
        supplierName?: string;
        quoteCode?: string;
        purchaseOrderNumber?: string;
        items?: Array<{
          productId?: string;
          productName?: string;
          quantity?: string | number;
          unitPrice?: string | number;
          discount?: string | number;
          note?: string;
        }>;
        paymentTerms?: string;
        discount?: string | number;
        status?: string;
        expirationDate?: string;
        notes?: string;
      };

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const linkedOfferResult = await query(
        'SELECT id FROM supplier_offers WHERE linked_quote_id = $1 LIMIT 1',
        [idResult.value],
      );
      if (linkedOfferResult.rows.length > 0) {
        return reply.code(409).send({ error: 'Quotes become read-only once an offer exists' });
      }

      let supplierIdValue: string | undefined | null = supplierId;
      if (supplierId !== undefined) {
        const supplierIdResult = optionalNonEmptyString(supplierId, 'supplierId');
        if (!supplierIdResult.ok) return badRequest(reply, supplierIdResult.message);
        supplierIdValue = supplierIdResult.value;
      }

      let supplierNameValue: string | undefined | null = supplierName;
      if (supplierName !== undefined) {
        const supplierNameResult = optionalNonEmptyString(supplierName, 'supplierName');
        if (!supplierNameResult.ok) return badRequest(reply, supplierNameResult.message);
        supplierNameValue = supplierNameResult.value;
      }

      let quoteCodeValue: string | undefined | null = quoteCode ?? purchaseOrderNumber;
      if (quoteCode !== undefined || purchaseOrderNumber !== undefined) {
        const quoteCodeResult = optionalNonEmptyString(
          quoteCode ?? purchaseOrderNumber,
          'quoteCode',
        );
        if (!quoteCodeResult.ok) return badRequest(reply, quoteCodeResult.message);
        quoteCodeValue = quoteCodeResult.value;
      }

      let expirationDateValue: string | undefined | null = expirationDate;
      if (expirationDate !== undefined) {
        const expirationDateResult = optionalDateString(expirationDate, 'expirationDate');
        if (!expirationDateResult.ok) return badRequest(reply, expirationDateResult.message);
        expirationDateValue = expirationDateResult.value;
      }

      let discountValue: number | undefined | null = discount as number | undefined;
      if (discount !== undefined) {
        const discountResult = optionalLocalizedNonNegativeNumber(discount, 'discount');
        if (!discountResult.ok) return badRequest(reply, discountResult.message);
        discountValue = discountResult.value;
      }

      const quoteResult = await query(
        `UPDATE supplier_quotes
       SET supplier_id = COALESCE($1, supplier_id),
           supplier_name = COALESCE($2, supplier_name),
           quote_code = COALESCE($3, quote_code),
           purchase_order_number = COALESCE($3, purchase_order_number),
           payment_terms = COALESCE($4, payment_terms),
           discount = COALESCE($5, discount),
           status = COALESCE($6, status),
           expiration_date = COALESCE($7, expiration_date),
           notes = COALESCE($8, notes),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $9
       RETURNING
        id,
        supplier_id as "supplierId",
        supplier_name as "supplierName",
        quote_code as "quoteCode",
        purchase_order_number as "purchaseOrderNumber",
        payment_terms as "paymentTerms",
        discount,
        status,
        expiration_date as "expirationDate",
        null::varchar as "linkedOfferId",
        notes,
        EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
        EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
        [
          supplierIdValue,
          supplierNameValue,
          quoteCodeValue,
          paymentTerms,
          discountValue,
          status,
          expirationDateValue,
          notes,
          idResult.value,
        ],
      );

      if (quoteResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Supplier quote not found' });
      }

      let updatedItems = [];
      if (items) {
        if (!Array.isArray(items) || items.length === 0) {
          return badRequest(reply, 'Items must be a non-empty array');
        }
        const normalizedItems = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
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
          normalizedItems.push({
            ...item,
            productName: productNameResult.value,
            quantity: quantityResult.value,
            unitPrice: unitPriceResult.value,
            discount: itemDiscountResult.value || 0,
          });
        }

        await query('DELETE FROM supplier_quote_items WHERE quote_id = $1', [idResult.value]);

        for (const item of normalizedItems) {
          const itemId = 'sqi-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
          const itemResult = await query(
            `INSERT INTO supplier_quote_items (
            id, quote_id, product_id, product_name, quantity, unit_price, discount, note
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING
            id,
            quote_id as "quoteId",
            product_id as "productId",
            product_name as "productName",
            quantity,
            unit_price as "unitPrice",
            discount,
            note`,
            [
              itemId,
              idResult.value,
              item.productId,
              item.productName,
              item.quantity,
              item.unitPrice,
              item.discount || 0,
              item.note || null,
            ],
          );
          updatedItems.push(itemResult.rows[0]);
        }
      } else {
        const itemsResult = await query(
          `SELECT
          id,
          quote_id as "quoteId",
          product_id as "productId",
          product_name as "productName",
          quantity,
          unit_price as "unitPrice",
          discount,
          note
         FROM supplier_quote_items
         WHERE quote_id = $1`,
          [idResult.value],
        );
        updatedItems = itemsResult.rows;
      }

      return {
        ...quoteResult.rows[0],
        status: normalizeSupplierQuoteStatus(quoteResult.rows[0].status),
        items: updatedItems,
      };
    },
  );

  fastify.delete(
    '/:id',
    {
      onRequest: [requirePermission('sales.supplier_quotes.delete')],
      schema: {
        tags: ['supplier-quotes'],
        summary: 'Delete supplier quote',
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
      const linkedOfferResult = await query(
        'SELECT id FROM supplier_offers WHERE linked_quote_id = $1 LIMIT 1',
        [idResult.value],
      );
      if (linkedOfferResult.rows.length > 0) {
        return reply
          .code(409)
          .send({ error: 'Cannot delete a quote once an offer has been created from it' });
      }
      const result = await query('DELETE FROM supplier_quotes WHERE id = $1 RETURNING id', [
        idResult.value,
      ]);

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Supplier quote not found' });
      }

      return reply.code(204).send();
    },
  );
}
