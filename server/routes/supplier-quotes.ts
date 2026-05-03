import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withDbTransaction } from '../db/drizzle.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as supplierQuotesRepo from '../repositories/supplierQuotesRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { getUniqueViolation } from '../utils/db-errors.ts';
import { generateItemId } from '../utils/order-ids.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import {
  badRequest,
  optionalDateString,
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

const normalizeUnitType = (value: unknown): 'hours' | 'days' | 'unit' => {
  if (value === 'days') return 'days';
  if (value === 'hours') return 'hours';
  return 'unit';
};

const normalizeSupplierQuoteStatus = (status: string) => {
  if (status === 'received') return 'sent';
  if (status === 'approved') return 'accepted';
  if (status === 'rejected') return 'denied';
  return status;
};

const projectQuote = (quote: supplierQuotesRepo.SupplierQuote) => ({
  ...quote,
  status: normalizeSupplierQuoteStatus(quote.status),
});

const projectItem = (item: supplierQuotesRepo.SupplierQuoteItem) => ({
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
    note: { type: ['string', 'null'] },
    unitType: { type: 'string', enum: ['hours', 'days', 'unit'] },
  },
  required: ['id', 'quoteId', 'productName', 'quantity', 'unitPrice'],
} as const;

const supplierQuoteSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    paymentTerms: { type: ['string', 'null'] },
    status: { type: 'string' },
    expirationDate: { type: ['string', 'null'], format: 'date' },
    linkedOrderId: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    items: { type: 'array', items: supplierQuoteItemSchema },
  },
  required: ['id', 'supplierId', 'supplierName', 'status', 'createdAt', 'updatedAt', 'items'],
} as const;

const supplierQuoteItemBodySchema = {
  type: 'object',
  properties: {
    productId: { type: 'string' },
    productName: { type: 'string' },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
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
    status: { type: 'string' },
    expirationDate: { type: 'string', format: 'date' },
    notes: { type: 'string' },
  },
} as const;

type ItemBody = {
  productId?: string;
  productName?: string;
  quantity?: string | number;
  unitPrice?: string | number;
  note?: string;
  unitType?: 'hours' | 'days' | 'unit';
};

const validateAndNormalizeItems = (
  items: ItemBody[],
  reply: FastifyReply,
): supplierQuotesRepo.NewSupplierQuoteItem[] | null => {
  const result: supplierQuotesRepo.NewSupplierQuoteItem[] = [];
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
    result.push({
      id: generateItemId('sqi-'),
      productId: item.productId || null,
      productName: productNameResult.value,
      quantity: quantityResult.value,
      unitPrice: unitPriceResult.value,
      note: item.note || null,
      unitType: normalizeUnitType(item.unitType),
    });
  }
  return result;
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.addHook('onRequest', authenticateToken);

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
      const [quotes, items] = await Promise.all([
        supplierQuotesRepo.listAll(),
        supplierQuotesRepo.listAllItems(),
      ]);
      const itemsByQuote: Record<string, ReturnType<typeof projectItem>[]> = {};
      for (const item of items) {
        if (!itemsByQuote[item.quoteId]) itemsByQuote[item.quoteId] = [];
        itemsByQuote[item.quoteId].push(projectItem(item));
      }
      return quotes.map((quote) => ({
        ...projectQuote(quote),
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
        status,
        expirationDate,
        notes,
      } = request.body as {
        id?: string;
        supplierId?: string;
        supplierName?: string;
        items?: ItemBody[];
        paymentTerms?: string;
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

      const normalizedItems = validateAndNormalizeItems(items, reply);
      if (!normalizedItems) return;

      const expirationDateResult = parseDateString(expirationDate, 'expirationDate');
      if (!expirationDateResult.ok) return badRequest(reply, expirationDateResult.message);

      let result: {
        quote: supplierQuotesRepo.SupplierQuote;
        items: supplierQuotesRepo.SupplierQuoteItem[];
      };
      try {
        result = await withDbTransaction(async (tx) => {
          const quote = await supplierQuotesRepo.create(
            {
              id: nextIdResult.value,
              supplierId: supplierIdResult.value,
              supplierName: supplierNameResult.value,
              paymentTerms: paymentTerms || 'immediate',
              status: status || 'draft',
              expirationDate: expirationDateResult.value,
              notes: notes ?? null,
            },
            tx,
          );
          const createdItems = await supplierQuotesRepo.insertItems(quote.id, normalizedItems, tx);
          return { quote, items: createdItems };
        });
      } catch (error) {
        const dup = getUniqueViolation(error);
        if (dup && (dup.constraint === 'supplier_quotes_pkey' || dup.detail?.includes('(id)'))) {
          return reply.code(409).send({ error: 'Quote ID already exists' });
        }
        throw error;
      }

      await logAudit({
        request,
        action: 'supplier_quote.created',
        entityType: 'supplier_quote',
        entityId: result.quote.id,
        details: {
          targetLabel: result.quote.id,
          secondaryLabel: result.quote.supplierName,
        },
      });
      return reply.code(201).send({
        ...projectQuote(result.quote),
        items: result.items.map(projectItem),
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
        status,
        expirationDate,
        notes,
      } = request.body as {
        id?: string;
        supplierId?: string;
        supplierName?: string;
        items?: ItemBody[];
        paymentTerms?: string;
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
        status === undefined &&
        expirationDate === undefined &&
        notes === undefined;

      const patch: supplierQuotesRepo.SupplierQuoteUpdate = {};

      if (supplierId !== undefined) {
        const supplierIdResult = optionalNonEmptyString(supplierId, 'supplierId');
        if (!supplierIdResult.ok) return badRequest(reply, supplierIdResult.message);
        if (supplierIdResult.value !== null) patch.supplierId = supplierIdResult.value;
      }

      if (supplierName !== undefined) {
        const supplierNameResult = optionalNonEmptyString(supplierName, 'supplierName');
        if (!supplierNameResult.ok) return badRequest(reply, supplierNameResult.message);
        if (supplierNameResult.value !== null) patch.supplierName = supplierNameResult.value;
      }

      let nextIdValue: string | null = null;
      if (nextId !== undefined) {
        const nextIdResult = optionalNonEmptyString(nextId, 'id');
        if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);
        nextIdValue = nextIdResult.value;
      }

      if (paymentTerms !== undefined) patch.paymentTerms = paymentTerms;
      if (status !== undefined) patch.status = status;
      if (notes !== undefined) patch.notes = notes;

      if (expirationDate !== undefined) {
        const expirationDateResult = optionalDateString(expirationDate, 'expirationDate');
        if (!expirationDateResult.ok) return badRequest(reply, expirationDateResult.message);
        if (expirationDateResult.value !== null) patch.expirationDate = expirationDateResult.value;
      }

      let normalizedItems: supplierQuotesRepo.NewSupplierQuoteItem[] | null = null;
      if (items) {
        if (!Array.isArray(items) || items.length === 0) {
          return badRequest(reply, 'Items must be a non-empty array');
        }
        normalizedItems = validateAndNormalizeItems(items, reply);
        if (!normalizedItems) return;
      }

      const [linkedOrderId, idConflict] = await Promise.all([
        isIdOnlyUpdate
          ? Promise.resolve(null)
          : supplierQuotesRepo.findLinkedOrderId(idResult.value),
        nextIdValue
          ? supplierQuotesRepo.findIdConflict(nextIdValue, idResult.value)
          : Promise.resolve(false),
      ]);
      if (linkedOrderId && !isIdOnlyUpdate) {
        return reply.code(409).send({ error: 'Quotes become read-only once an order exists' });
      }
      if (idConflict) {
        return reply.code(409).send({ error: 'Quote ID already exists' });
      }
      if (nextIdValue !== null) patch.id = nextIdValue;

      let updated: supplierQuotesRepo.SupplierQuote | null;
      let resultItems: supplierQuotesRepo.SupplierQuoteItem[];
      try {
        const txResult = await withDbTransaction(async (tx) => {
          const quote = await supplierQuotesRepo.update(idResult.value, patch, tx);
          if (!quote) return { quote: null, items: [] as supplierQuotesRepo.SupplierQuoteItem[] };
          const finalItems = normalizedItems
            ? await supplierQuotesRepo.replaceItems(quote.id, normalizedItems, tx)
            : await supplierQuotesRepo.findItemsForQuote(quote.id, tx);
          return { quote, items: finalItems };
        });
        updated = txResult.quote;
        resultItems = txResult.items;
      } catch (error) {
        const dup = getUniqueViolation(error);
        if (dup && (dup.constraint === 'supplier_quotes_pkey' || dup.detail?.includes('(id)'))) {
          return reply.code(409).send({ error: 'Quote ID already exists' });
        }
        throw error;
      }

      if (!updated) {
        return reply.code(404).send({ error: 'Supplier quote not found' });
      }

      await logAudit({
        request,
        action: 'supplier_quote.updated',
        entityType: 'supplier_quote',
        entityId: updated.id,
        details: {
          targetLabel: updated.id,
          secondaryLabel: updated.supplierName,
        },
      });
      return {
        ...projectQuote(updated),
        items: resultItems.map(projectItem),
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

      const linkedOrderId = await supplierQuotesRepo.findLinkedOrderId(idResult.value);
      if (linkedOrderId) {
        return reply
          .code(409)
          .send({ error: 'Cannot delete a quote once an order has been created from it' });
      }

      const deleted = await supplierQuotesRepo.deleteById(idResult.value);
      if (!deleted) {
        return reply.code(404).send({ error: 'Supplier quote not found' });
      }

      await logAudit({
        request,
        action: 'supplier_quote.deleted',
        entityType: 'supplier_quote',
        entityId: idResult.value,
        details: {
          targetLabel: idResult.value,
          secondaryLabel: deleted.supplierName,
        },
      });
      return reply.code(204).send();
    },
  );
}
