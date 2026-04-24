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

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const normalizeUnitType = (value: unknown): 'hours' | 'days' | 'unit' => {
  if (value === 'days') return 'days';
  if (value === 'hours') return 'hours';
  return 'unit';
};

const normalizeSupplierQuoteItemRow = (item: Record<string, unknown>) => ({
  ...item,
  unitType: normalizeUnitType(item.unitType),
});

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
    unitType: { type: 'string', enum: ['hours', 'days', 'unit'] },
  },
  required: ['id', 'quoteId', 'productName', 'quantity', 'unitPrice', 'discount'],
} as const;

const supplierQuoteSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    paymentTerms: { type: ['string', 'null'] },
    discount: { type: 'number' },
    status: { type: 'string' },
    expirationDate: { type: ['string', 'null'], format: 'date' },
    linkedOrderId: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    items: { type: 'array', items: supplierQuoteItemSchema },
  },
  required: [
    'id',
    'supplierId',
    'supplierName',
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
    unitType: { type: 'string', enum: ['hours', 'days', 'unit'] },
  },
  required: ['productName', 'quantity', 'unitPrice'],
} as const;

const supplierQuoteCreateBodySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    items: { type: 'array', items: supplierQuoteItemBodySchema },
    paymentTerms: { type: 'string' },
    discount: { type: 'number' },
    status: { type: 'string' },
    expirationDate: { type: 'string', format: 'date' },
    notes: { type: 'string' },
  },
  required: ['id', 'supplierId', 'supplierName', 'items', 'expirationDate'],
} as const;

const supplierQuoteUpdateBodySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
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

  const normalizeSupplierQuoteRow = (quote: Record<string, unknown>) => ({
    ...quote,
    discountType: quote.discountType === 'currency' ? 'currency' : 'percentage',
    status: normalizeSupplierQuoteStatus(String(quote.status)),
    expirationDate: normalizeNullableDateOnly(quote.expirationDate, 'supplierQuote.expirationDate'),
  });

  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('sales.supplier_quotes.view'),
      ],
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
        payment_terms as "paymentTerms",
        discount,
        discount_type as "discountType",
        status,
        expiration_date as "expirationDate",
        (
          SELECT ss.id
          FROM supplier_sales ss
          WHERE ss.linked_quote_id = supplier_quotes.id
          LIMIT 1
        ) as "linkedOrderId",
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
        note,
        unit_type as "unitType"
       FROM supplier_quote_items
       ORDER BY created_at ASC`,
      );

      const itemsByQuote: Record<string, unknown[]> = {};
      itemsResult.rows.forEach((item) => {
        const quoteId = (item as { quoteId: string }).quoteId;
        if (!itemsByQuote[quoteId]) {
          itemsByQuote[quoteId] = [];
        }
        itemsByQuote[quoteId].push(normalizeSupplierQuoteItemRow(item as Record<string, unknown>));
      });

      return quotesResult.rows.map((quote) => ({
        ...normalizeSupplierQuoteRow(quote as Record<string, unknown>),
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
        id: nextId,
        supplierId,
        supplierName,
        items,
        paymentTerms,
        discount,
        discountType,
        status,
        expirationDate,
        notes,
      } = request.body as {
        id?: string;
        supplierId?: string;
        supplierName?: string;
        items?: Array<{
          productId?: string;
          productName?: string;
          quantity?: string | number;
          unitPrice?: string | number;
          discount?: string | number;
          note?: string;
          unitType?: 'hours' | 'days' | 'unit';
        }>;
        paymentTerms?: string;
        discount?: string | number;
        discountType?: unknown;
        status?: string;
        expirationDate?: string;
        notes?: string;
      };

      const supplierIdResult = requireNonEmptyString(supplierId, 'supplierId');
      if (!supplierIdResult.ok) return badRequest(reply, supplierIdResult.message);

      const supplierNameResult = requireNonEmptyString(supplierName, 'supplierName');
      if (!supplierNameResult.ok) return badRequest(reply, supplierNameResult.message);
      const nextIdResult = requireNonEmptyString(nextId, 'id');
      if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);

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
          unitType: normalizeUnitType(item.unitType),
        });
      }

      const expirationDateResult = parseDateString(expirationDate, 'expirationDate');
      if (!expirationDateResult.ok) return badRequest(reply, expirationDateResult.message);

      const discountResult = optionalLocalizedNonNegativeNumber(discount, 'discount');
      if (!discountResult.ok) return badRequest(reply, discountResult.message);
      const discountTypeValue = discountType === 'currency' ? 'currency' : 'percentage';

      let quoteResult: Awaited<ReturnType<typeof query>>;
      try {
        quoteResult = await query(
          `INSERT INTO supplier_quotes (
          id, supplier_id, supplier_name, payment_terms, discount, discount_type, status, expiration_date, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING
          id,
          supplier_id as "supplierId",
          supplier_name as "supplierName",
          payment_terms as "paymentTerms",
          discount,
          discount_type as "discountType",
          status,
          expiration_date as "expirationDate",
          null::varchar as "linkedOrderId",
          notes,
          EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
          EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
          [
            nextIdResult.value,
            supplierIdResult.value,
            supplierNameResult.value,
            paymentTerms || 'immediate',
            discountResult.value || 0,
            discountTypeValue,
            status || 'draft',
            expirationDateResult.value,
            notes,
          ],
        );
      } catch (error) {
        const databaseError = error as DatabaseError;
        if (
          databaseError.code === '23505' &&
          (databaseError.constraint === 'supplier_quotes_pkey' ||
            databaseError.detail?.includes('(id)'))
        ) {
          return reply.code(409).send({ error: 'Quote ID already exists' });
        }
        throw error;
      }

      const createdItems = [];
      for (const item of normalizedItems) {
        const itemId = 'sqi-' + Date.now() + '-' + Math.random().toString(36).substring(2, 11);
        const itemResult = await query(
          `INSERT INTO supplier_quote_items (
          id, quote_id, product_id, product_name, quantity, unit_price, discount, note, unit_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING
          id,
          quote_id as "quoteId",
          product_id as "productId",
          product_name as "productName",
          quantity,
          unit_price as "unitPrice",
          discount,
          note,
          unit_type as "unitType"`,
          [
            itemId,
            nextIdResult.value,
            item.productId || null,
            item.productName,
            item.quantity,
            item.unitPrice,
            item.discount || 0,
            item.note || null,
            item.unitType || 'unit',
          ],
        );
        createdItems.push(
          normalizeSupplierQuoteItemRow(itemResult.rows[0] as Record<string, unknown>),
        );
      }

      await logAudit({
        request,
        action: 'supplier_quote.created',
        entityType: 'supplier_quote',
        entityId: nextIdResult.value,
        details: {
          targetLabel: nextIdResult.value,
          secondaryLabel: supplierNameResult.value,
        },
      });
      return reply.code(201).send({
        ...normalizeSupplierQuoteRow(quoteResult.rows[0] as Record<string, unknown>),
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
        id: nextId,
        supplierId,
        supplierName,
        items,
        paymentTerms,
        discount,
        discountType,
        status,
        expirationDate,
        notes,
      } = request.body as {
        id?: string;
        supplierId?: string;
        supplierName?: string;
        items?: Array<{
          productId?: string;
          productName?: string;
          quantity?: string | number;
          unitPrice?: string | number;
          discount?: string | number;
          note?: string;
          unitType?: 'hours' | 'days' | 'unit';
        }>;
        paymentTerms?: string;
        discount?: string | number;
        discountType?: unknown;
        status?: string;
        expirationDate?: string;
        notes?: string;
      };

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const isIdOnlyUpdate =
        nextId !== undefined &&
        supplierId === undefined &&
        supplierName === undefined &&
        items === undefined &&
        paymentTerms === undefined &&
        discount === undefined &&
        status === undefined &&
        expirationDate === undefined &&
        notes === undefined;

      const linkedOrderResult = await query(
        'SELECT id FROM supplier_sales WHERE linked_quote_id = $1 LIMIT 1',
        [idResult.value],
      );
      if (linkedOrderResult.rows.length > 0 && !isIdOnlyUpdate) {
        return reply.code(409).send({ error: 'Quotes become read-only once an order exists' });
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

      let nextIdValue: string | undefined | null = nextId;
      if (nextId !== undefined) {
        const nextIdResult = optionalNonEmptyString(nextId, 'id');
        if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);
        nextIdValue = nextIdResult.value;
        if (nextIdResult.value) {
          const existingIdResult = await query(
            'SELECT id FROM supplier_quotes WHERE id = $1 AND id <> $2',
            [nextIdResult.value, idResult.value],
          );
          if (existingIdResult.rows.length > 0) {
            return reply.code(409).send({ error: 'Quote ID already exists' });
          }
        }
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

      const discountTypeValue =
        discountType !== undefined
          ? discountType === 'currency'
            ? 'currency'
            : 'percentage'
          : undefined;

      let quoteResult: Awaited<ReturnType<typeof query>>;
      try {
        quoteResult = await query(
          `UPDATE supplier_quotes
         SET id = COALESCE($1, id),
             supplier_id = COALESCE($2, supplier_id),
             supplier_name = COALESCE($3, supplier_name),
             payment_terms = COALESCE($4, payment_terms),
             discount = COALESCE($5, discount),
             discount_type = COALESCE($6, discount_type),
             status = COALESCE($7, status),
             expiration_date = COALESCE($8, expiration_date),
             notes = COALESCE($9, notes),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $10
         RETURNING
          id,
          supplier_id as "supplierId",
           supplier_name as "supplierName",
           payment_terms as "paymentTerms",
           discount,
           discount_type as "discountType",
           status,
           expiration_date as "expirationDate",
           null::varchar as "linkedOrderId",
           notes,
          EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
          EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
          [
            nextIdValue,
            supplierIdValue,
            supplierNameValue,
            paymentTerms,
            discountValue,
            discountTypeValue,
            status,
            expirationDateValue,
            notes,
            idResult.value,
          ],
        );
      } catch (error) {
        const databaseError = error as DatabaseError;
        if (
          databaseError.code === '23505' &&
          (databaseError.constraint === 'supplier_quotes_pkey' ||
            databaseError.detail?.includes('(id)'))
        ) {
          return reply.code(409).send({ error: 'Quote ID already exists' });
        }
        throw error;
      }

      if (quoteResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Supplier quote not found' });
      }

      const updatedQuoteId = String(quoteResult.rows[0].id);

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
            unitType: normalizeUnitType(item.unitType),
          });
        }

        await query('DELETE FROM supplier_quote_items WHERE quote_id = $1', [updatedQuoteId]);

        for (const item of normalizedItems) {
          const itemId = 'sqi-' + Date.now() + '-' + Math.random().toString(36).substring(2, 11);
          const itemResult = await query(
            `INSERT INTO supplier_quote_items (
            id, quote_id, product_id, product_name, quantity, unit_price, discount, note, unit_type
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING
            id,
            quote_id as "quoteId",
            product_id as "productId",
            product_name as "productName",
            quantity,
            unit_price as "unitPrice",
            discount,
            note,
            unit_type as "unitType"`,
            [
              itemId,
              updatedQuoteId,
              item.productId || null,
              item.productName,
              item.quantity,
              item.unitPrice,
              item.discount || 0,
              item.note || null,
              item.unitType || 'unit',
            ],
          );
          updatedItems.push(
            normalizeSupplierQuoteItemRow(itemResult.rows[0] as Record<string, unknown>),
          );
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
          note,
          unit_type as "unitType"
         FROM supplier_quote_items
         WHERE quote_id = $1`,
          [updatedQuoteId],
        );
        updatedItems = itemsResult.rows.map((item) =>
          normalizeSupplierQuoteItemRow(item as Record<string, unknown>),
        );
      }

      await logAudit({
        request,
        action: 'supplier_quote.updated',
        entityType: 'supplier_quote',
        entityId: updatedQuoteId,
        details: {
          targetLabel: updatedQuoteId,
          secondaryLabel: String(quoteResult.rows[0].supplierName ?? ''),
        },
      });
      return {
        ...normalizeSupplierQuoteRow(quoteResult.rows[0] as Record<string, unknown>),
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
      const linkedOrderResult = await query(
        'SELECT id FROM supplier_sales WHERE linked_quote_id = $1 LIMIT 1',
        [idResult.value],
      );
      if (linkedOrderResult.rows.length > 0) {
        return reply
          .code(409)
          .send({ error: 'Cannot delete a quote once an order has been created from it' });
      }
      const result = await query(
        'DELETE FROM supplier_quotes WHERE id = $1 RETURNING id, supplier_name as "supplierName"',
        [idResult.value],
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Supplier quote not found' });
      }

      await logAudit({
        request,
        action: 'supplier_quote.deleted',
        entityType: 'supplier_quote',
        entityId: idResult.value,
        details: {
          targetLabel: idResult.value,
          secondaryLabel: String(result.rows[0].supplierName ?? ''),
        },
      });
      return reply.code(204).send();
    },
  );
}
