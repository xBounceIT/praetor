import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type DbExecutor, withDbTransaction } from '../db/drizzle.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as productsRepo from '../repositories/productsRepo.ts';
import * as supplierQuoteAttachmentsRepo from '../repositories/supplierQuoteAttachmentsRepo.ts';
import * as supplierQuotesRepo from '../repositories/supplierQuotesRepo.ts';
import * as supplierQuoteVersionsRepo from '../repositories/supplierQuoteVersionsRepo.ts';
import * as suppliersRepo from '../repositories/suppliersRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { getUniqueViolation } from '../utils/db-errors.ts';
import {
  ATTACHMENT_MAX_BYTES,
  deleteSupplierQuoteAttachment,
  isAllowedAttachment,
  type OpenedAttachment,
  openSupplierQuoteAttachment,
  saveSupplierQuoteAttachment,
} from '../utils/fileStorage.ts';
import { createChildLogger } from '../utils/logger.ts';
import { generateItemId, generatePrefixedId } from '../utils/order-ids.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { replyError } from '../utils/replyError.ts';
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

  const snapshotPreState = async (
    quoteId: string,
    reason: supplierQuoteVersionsRepo.SupplierQuoteVersionReason,
    request: FastifyRequest,
    tx: DbExecutor,
  ) => {
    const pre = await supplierQuotesRepo.findFullForSnapshot(quoteId, tx);
    if (!pre) return;
    await supplierQuoteVersionsRepo.insert(
      {
        quoteId,
        snapshot: supplierQuoteVersionsRepo.buildSnapshot(pre.quote, pre.items),
        reason,
        createdByUserId: request.user?.id ?? null,
      },
      tx,
    );
  };

  const findMissingSnapshotReference = async (
    snapshot: supplierQuoteVersionsRepo.SupplierQuoteVersionSnapshot,
  ): Promise<string | null> => {
    const productIds = Array.from(
      new Set(
        snapshot.items
          .map((item) => item.productId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    );

    const [supplier, products] = await Promise.all([
      suppliersRepo.findById(snapshot.quote.supplierId),
      productIds.length > 0 ? productsRepo.getSnapshots(productIds) : Promise.resolve(null),
    ]);

    if (!supplier) {
      return `Snapshot supplier "${snapshot.quote.supplierId}" no longer exists`;
    }
    if (!products) return null;

    const missingProductId = productIds.find((id) => !products.has(id));
    return missingProductId ? `Snapshot product "${missingProductId}" no longer exists` : null;
  };

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
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Quote ID already exists',
            action: 'supplier_quote.create.conflict',
            entityType: 'supplier_quote',
            details: { secondaryLabel: 'duplicate_id' },
          });
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

      // Two related flags with different jobs: `hasNonStatusOrIdUpdates` drives the
      // non-draft read-only guard (status transitions and id renames must still be allowed
      // on sent/accepted/denied quotes); `hasContentUpdate` drives whether to take a
      // version snapshot before writing (status transitions DO want a snapshot, id-only
      // renames do not).
      const hasNonStatusOrIdUpdates =
        supplierId !== undefined ||
        supplierName !== undefined ||
        items !== undefined ||
        paymentTerms !== undefined ||
        expirationDate !== undefined ||
        notes !== undefined;
      const hasContentUpdate = hasNonStatusOrIdUpdates || status !== undefined;

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

      const [current, linkedOrderId, idConflict] = await Promise.all([
        supplierQuotesRepo.findById(idResult.value),
        supplierQuotesRepo.findLinkedOrderId(idResult.value),
        nextIdValue
          ? supplierQuotesRepo.findIdConflict(nextIdValue, idResult.value)
          : Promise.resolve(false),
      ]);
      if (!current) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Supplier quote not found',
          action: 'supplier_quote.update.not_found',
          entityType: 'supplier_quote',
          entityId: idResult.value,
        });
      }
      if (linkedOrderId) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Quotes become read-only once an order exists',
          action: 'supplier_quote.update.conflict',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'order_exists' },
        });
      }
      if (normalizeSupplierQuoteStatus(current.status) !== 'draft' && hasNonStatusOrIdUpdates) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Non-draft supplier quotes are read-only',
          action: 'supplier_quote.update.conflict',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'non_draft_read_only', fromValue: current.status },
        });
      }
      if (idConflict) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Quote ID already exists',
          action: 'supplier_quote.update.conflict',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'duplicate_id' },
        });
      }
      if (nextIdValue !== null) patch.id = nextIdValue;

      let updated: supplierQuotesRepo.SupplierQuote | null;
      let resultItems: supplierQuotesRepo.SupplierQuoteItem[];
      try {
        const txResult = await withDbTransaction(async (tx) => {
          // Snapshot only when the patch carries actual content. ID-only renames cascade
          // through the FK without altering snapshot fields, and empty PUTs are no-ops in
          // `update()` - both would otherwise create misleading "Save" rows.
          if (hasContentUpdate) {
            await snapshotPreState(idResult.value, 'update', request, tx);
          }
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
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Quote ID already exists',
            action: 'supplier_quote.update.conflict',
            entityType: 'supplier_quote',
            entityId: idResult.value,
            details: { secondaryLabel: 'duplicate_id' },
          });
        }
        throw error;
      }

      if (!updated) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Supplier quote not found',
          action: 'supplier_quote.update.not_found',
          entityType: 'supplier_quote',
          entityId: idResult.value,
        });
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

  const supplierQuoteVersionRowSchema = {
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

  const supplierQuoteVersionSchema = {
    type: 'object',
    properties: { ...supplierQuoteVersionRowSchema.properties, snapshot: {} },
    required: [...supplierQuoteVersionRowSchema.required, 'snapshot'],
  } as const;

  fastify.get(
    '/:id/versions',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('sales.supplier_quotes.view'),
      ],
      schema: {
        tags: ['supplier-quotes'],
        summary: 'List versions for a supplier quote',
        params: idParamSchema,
        response: {
          200: { type: 'array', items: supplierQuoteVersionRowSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const [exists, versions] = await Promise.all([
        supplierQuotesRepo.existsById(idResult.value),
        supplierQuoteVersionsRepo.listForQuote(idResult.value),
      ]);
      if (!exists) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Supplier quote not found',
          action: 'supplier_quote.versions_list.not_found',
          entityType: 'supplier_quote',
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
        requirePermission('sales.supplier_quotes.view'),
      ],
      schema: {
        tags: ['supplier-quotes'],
        summary: 'Get a single supplier quote version',
        params: versionParamSchema,
        response: {
          200: supplierQuoteVersionSchema,
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

      const version = await supplierQuoteVersionsRepo.findById(
        idResult.value,
        versionIdResult.value,
      );
      if (!version) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Version not found',
          action: 'supplier_quote.version_get.not_found',
          entityType: 'supplier_quote',
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
      onRequest: [requirePermission('sales.supplier_quotes.update')],
      schema: {
        tags: ['supplier-quotes'],
        summary: 'Restore a supplier quote to a prior version',
        params: versionParamSchema,
        response: {
          200: supplierQuoteSchema,
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

      const [linkedOrderId, exists, version] = await Promise.all([
        supplierQuotesRepo.findLinkedOrderId(idResult.value),
        supplierQuotesRepo.existsById(idResult.value),
        supplierQuoteVersionsRepo.findById(idResult.value, versionIdResult.value),
      ]);

      if (linkedOrderId) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Quotes become read-only once an order exists',
          action: 'supplier_quote.restore.conflict',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'order_exists' },
        });
      }
      if (!exists) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Supplier quote not found',
          action: 'supplier_quote.restore.not_found',
          entityType: 'supplier_quote',
          entityId: idResult.value,
        });
      }
      if (!version) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Version not found',
          action: 'supplier_quote.restore.not_found',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: versionIdResult.value },
        });
      }
      const missingSnapshotReference = await findMissingSnapshotReference(version.snapshot);
      if (missingSnapshotReference) {
        return replyError(request, reply, {
          statusCode: 409,
          message: missingSnapshotReference,
          action: 'supplier_quote.restore.conflict',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'snapshot_reference_missing' },
        });
      }
      const snapshotExpirationDate = version.snapshot.quote.expirationDate;
      if (!snapshotExpirationDate) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Snapshot expiration date is missing',
          action: 'supplier_quote.restore.conflict',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'snapshot_expiration_missing' },
        });
      }

      const snapshotItems: supplierQuotesRepo.NewSupplierQuoteItem[] = version.snapshot.items.map(
        ({ quoteId: _q, ...rest }) => ({
          ...rest,
          id: generateItemId('sqi-'),
          productId: rest.productId || null,
          unitType: rest.unitType ?? 'unit',
          note: rest.note ?? null,
        }),
      );

      const restored = await withDbTransaction(async (tx) => {
        // Snapshot current with reason='restore' so the just-replaced data stays recoverable.
        await snapshotPreState(idResult.value, 'restore', request, tx);

        const quote = await supplierQuotesRepo.restoreSnapshotQuote(
          idResult.value,
          {
            supplierId: version.snapshot.quote.supplierId,
            supplierName: version.snapshot.quote.supplierName,
            paymentTerms: version.snapshot.quote.paymentTerms ?? 'immediate',
            status: version.snapshot.quote.status,
            expirationDate: snapshotExpirationDate,
            notes: version.snapshot.quote.notes,
          },
          tx,
        );
        if (!quote) return { quote: null, items: [] as supplierQuotesRepo.SupplierQuoteItem[] };
        const items = await supplierQuotesRepo.replaceItems(quote.id, snapshotItems, tx);
        return { quote, items };
      });

      if (!restored.quote) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Supplier quote not found',
          action: 'supplier_quote.restore.not_found',
          entityType: 'supplier_quote',
          entityId: idResult.value,
        });
      }

      await logAudit({
        request,
        action: 'supplier_quote.restored',
        entityType: 'supplier_quote',
        entityId: restored.quote.id,
        details: {
          targetLabel: restored.quote.id,
          secondaryLabel: restored.quote.supplierName,
          toValue: versionIdResult.value,
        },
      });

      return {
        ...projectQuote(restored.quote),
        items: restored.items.map(projectItem),
      };
    },
  );

  // ---------------------------------------------------------------------------------------
  // Attachments
  // ---------------------------------------------------------------------------------------

  const attachmentsLogger = createChildLogger({ module: 'supplier-quote-attachments' });

  const attachmentParamSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      attachmentId: { type: 'string' },
    },
    required: ['id', 'attachmentId'],
  } as const;

  const supplierQuoteAttachmentSchema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      quoteId: { type: 'string' },
      fileName: { type: 'string' },
      mimeType: { type: 'string' },
      fileSize: { type: 'number' },
      uploadedByUserId: { type: ['string', 'null'] },
      createdAt: { type: 'number' },
    },
    required: ['id', 'quoteId', 'fileName', 'mimeType', 'fileSize', 'createdAt'],
  } as const;

  const projectAttachment = (attachment: supplierQuoteAttachmentsRepo.SupplierQuoteAttachment) => ({
    id: attachment.id,
    quoteId: attachment.quoteId,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    fileSize: attachment.fileSize,
    uploadedByUserId: attachment.uploadedByUserId,
    createdAt: attachment.createdAt,
  });

  // Mutation guard mirrors the existing supplier-quote edit rules: only `draft` quotes that
  // are not yet linked to an order may be modified. Returns the quote on success, or sends
  // the appropriate error response and returns null.
  const assertQuoteEditableForAttachments = async (
    id: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<supplierQuotesRepo.SupplierQuote | null> => {
    const [quote, linkedOrderId] = await Promise.all([
      supplierQuotesRepo.findById(id),
      supplierQuotesRepo.findLinkedOrderId(id),
    ]);
    if (!quote) {
      await replyError(request, reply, {
        statusCode: 404,
        message: 'Supplier quote not found',
        action: 'supplier_quote_attachment.mutate.not_found',
        entityType: 'supplier_quote',
        entityId: id,
      });
      return null;
    }
    if (linkedOrderId) {
      await replyError(request, reply, {
        statusCode: 409,
        message: 'Quotes become read-only once an order exists',
        action: 'supplier_quote_attachment.mutate.conflict',
        entityType: 'supplier_quote',
        entityId: id,
        details: { secondaryLabel: 'order_exists' },
      });
      return null;
    }
    if (normalizeSupplierQuoteStatus(quote.status) !== 'draft') {
      await replyError(request, reply, {
        statusCode: 409,
        message: 'Attachments can only be modified on draft supplier quotes',
        action: 'supplier_quote_attachment.mutate.conflict',
        entityType: 'supplier_quote',
        entityId: id,
        details: { secondaryLabel: 'non_draft_status', fromValue: quote.status },
      });
      return null;
    }
    return quote;
  };

  fastify.get(
    '/:id/attachments',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('sales.supplier_quotes.view'),
      ],
      schema: {
        tags: ['supplier-quotes'],
        summary: 'List attachments for a supplier quote',
        params: idParamSchema,
        response: {
          200: { type: 'array', items: supplierQuoteAttachmentSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const exists = await supplierQuotesRepo.existsById(idResult.value);
      if (!exists) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Supplier quote not found',
          action: 'supplier_quote_attachment.list.not_found',
          entityType: 'supplier_quote',
          entityId: idResult.value,
        });
      }
      const attachments = await supplierQuoteAttachmentsRepo.listForQuote(idResult.value);
      return attachments.map(projectAttachment);
    },
  );

  fastify.post(
    '/:id/attachments',
    {
      onRequest: [requirePermission('sales.supplier_quotes.update')],
      schema: {
        tags: ['supplier-quotes'],
        summary: 'Upload an attachment to a supplier quote',
        params: idParamSchema,
        consumes: ['multipart/form-data'],
        response: {
          201: supplierQuoteAttachmentSchema,
          ...standardErrorResponses,
          413: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
          415: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      if (!request.isMultipart()) {
        return replyError(request, reply, {
          statusCode: 400,
          message: 'Request must be multipart/form-data',
          action: 'supplier_quote_attachment.upload.invalid',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'not_multipart' },
        });
      }

      const quote = await assertQuoteEditableForAttachments(idResult.value, request, reply);
      if (!quote) return;

      let uploaded: { storedName: string; size: number } | null = null;
      try {
        const part = await request.file();
        if (!part) {
          return replyError(request, reply, {
            statusCode: 400,
            message: 'A file is required',
            action: 'supplier_quote_attachment.upload.invalid',
            entityType: 'supplier_quote',
            entityId: idResult.value,
            details: { secondaryLabel: 'no_file' },
          });
        }

        const originalName = part.filename?.trim();

        // Drain the multipart stream up front, before any validation early-returns. If we
        // bail on filename/MIME without consuming `part.file`, fastify-multipart leaves the
        // request body un-drained which can stall the connection until the parser times out.
        let buffer: Buffer;
        try {
          buffer = await part.toBuffer();
        } catch (err) {
          if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
            return reply.code(413).send({ error: 'File exceeds the 10 MB upload limit' });
          }
          throw err;
        }

        if (!originalName) {
          return replyError(request, reply, {
            statusCode: 400,
            message: 'Uploaded file is missing a filename',
            action: 'supplier_quote_attachment.upload.invalid',
            entityType: 'supplier_quote',
            entityId: idResult.value,
            details: { secondaryLabel: 'missing_filename' },
          });
        }

        const mimeType = part.mimetype || 'application/octet-stream';
        if (!isAllowedAttachment(mimeType, originalName)) {
          return reply.code(415).send({ error: 'File type not allowed. Use xlsx, pdf, or docx.' });
        }

        if (buffer.byteLength > ATTACHMENT_MAX_BYTES) {
          return reply.code(413).send({ error: 'File exceeds the 10 MB upload limit' });
        }
        if (buffer.byteLength === 0) {
          return replyError(request, reply, {
            statusCode: 400,
            message: 'Uploaded file is empty',
            action: 'supplier_quote_attachment.upload.invalid',
            entityType: 'supplier_quote',
            entityId: idResult.value,
            details: { secondaryLabel: 'empty_file' },
          });
        }

        uploaded = await saveSupplierQuoteAttachment(buffer, originalName);

        const attachment = await supplierQuoteAttachmentsRepo.insert({
          id: generatePrefixedId('sqa'),
          quoteId: idResult.value,
          fileName: originalName,
          storedName: uploaded.storedName,
          mimeType,
          fileSize: uploaded.size,
          uploadedByUserId: request.user?.id ?? null,
        });
        // DB row is now the source of truth - clear the cleanup token before audit so a
        // failing audit log doesn't unlink the file under a live row.
        uploaded = null;

        await logAudit({
          request,
          action: 'supplier_quote_attachment.uploaded',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: {
            targetLabel: attachment.fileName,
            secondaryLabel: quote.supplierName,
          },
        });

        return reply.code(201).send(projectAttachment(attachment));
      } finally {
        if (uploaded) {
          await deleteSupplierQuoteAttachment(uploaded.storedName).catch((err) => {
            attachmentsLogger.warn(
              { err, storedName: uploaded?.storedName },
              'Failed to clean up orphaned upload after error',
            );
          });
        }
      }
    },
  );

  fastify.get(
    '/:id/attachments/:attachmentId/download',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('sales.supplier_quotes.view'),
      ],
      schema: {
        tags: ['supplier-quotes'],
        summary: 'Download a supplier-quote attachment',
        params: attachmentParamSchema,
        response: {
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, attachmentId } = request.params as { id: string; attachmentId: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      const attachmentIdResult = requireNonEmptyString(attachmentId, 'attachmentId');
      if (!attachmentIdResult.ok) return badRequest(reply, attachmentIdResult.message);

      const attachment = await supplierQuoteAttachmentsRepo.findById(attachmentIdResult.value);
      if (!attachment || attachment.quoteId !== idResult.value) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Attachment not found',
          action: 'supplier_quote_attachment.download.not_found',
          entityType: 'supplier_quote_attachment',
          entityId: attachmentIdResult.value,
        });
      }

      let opened: OpenedAttachment;
      try {
        opened = await openSupplierQuoteAttachment(attachment.storedName);
      } catch (err) {
        attachmentsLogger.warn(
          { err, attachmentId: attachment.id },
          'Stored attachment file is missing or unreadable',
        );
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Attachment file is no longer available',
          action: 'supplier_quote_attachment.download.not_found',
          entityType: 'supplier_quote_attachment',
          entityId: attachmentIdResult.value,
          details: { secondaryLabel: 'file_missing' },
        });
      }

      // RFC 6266: provide an ASCII-safe `filename` for legacy clients plus an RFC 5987
      // `filename*` with UTF-8 encoding for Unicode filenames. Strip CR/LF/quote/backslash
      // from the legacy form to prevent header injection through user-controlled filenames.
      // `encodeURIComponent` already emits valid `%XX%XX` UTF-8 byte pairs; we only need to
      // additionally encode `'`, `(`, `)` per RFC 5987 (the legacy global `escape()` would
      // emit invalid `%uXXXX` for non-BMP codepoints, hence explicit replacements here).
      const asciiFallback = attachment.fileName.replace(/[\r\n"\\]/g, '');
      const utf8EncodedName = encodeURIComponent(attachment.fileName)
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29');
      reply.header('Content-Type', attachment.mimeType || 'application/octet-stream');
      reply.header('Content-Length', String(opened.size));
      reply.header(
        'Content-Disposition',
        `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8EncodedName}`,
      );
      return reply.send(opened.stream);
    },
  );

  fastify.delete(
    '/:id/attachments/:attachmentId',
    {
      onRequest: [requirePermission('sales.supplier_quotes.update')],
      schema: {
        tags: ['supplier-quotes'],
        summary: 'Delete a supplier-quote attachment',
        params: attachmentParamSchema,
        response: {
          204: { type: 'null' },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, attachmentId } = request.params as { id: string; attachmentId: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      const attachmentIdResult = requireNonEmptyString(attachmentId, 'attachmentId');
      if (!attachmentIdResult.ok) return badRequest(reply, attachmentIdResult.message);

      const quote = await assertQuoteEditableForAttachments(idResult.value, request, reply);
      if (!quote) return;

      const deleted = await supplierQuoteAttachmentsRepo.deleteById(
        attachmentIdResult.value,
        idResult.value,
      );
      if (!deleted) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Attachment not found',
          action: 'supplier_quote_attachment.delete.not_found',
          entityType: 'supplier_quote_attachment',
          entityId: attachmentIdResult.value,
        });
      }

      await deleteSupplierQuoteAttachment(deleted.storedName).catch((err) => {
        attachmentsLogger.warn(
          { err, storedName: deleted.storedName },
          'Failed to remove attachment file from disk',
        );
      });

      await logAudit({
        request,
        action: 'supplier_quote_attachment.deleted',
        entityType: 'supplier_quote',
        entityId: idResult.value,
        details: {
          targetLabel: deleted.fileName,
          secondaryLabel: quote.supplierName,
        },
      });
      return reply.code(204).send();
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
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Cannot delete a quote once an order has been created from it',
          action: 'supplier_quote.delete.conflict',
          entityType: 'supplier_quote',
          entityId: idResult.value,
          details: { secondaryLabel: 'order_exists' },
        });
      }

      // Fetch attachment metadata BEFORE deleting the quote - the FK cascade will drop the
      // rows, leaving us no way to learn which files to clean off disk.
      const attachmentsToCleanup = await supplierQuoteAttachmentsRepo.listForQuote(idResult.value);

      const deleted = await supplierQuotesRepo.deleteById(idResult.value);
      if (!deleted) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Supplier quote not found',
          action: 'supplier_quote.delete.not_found',
          entityType: 'supplier_quote',
          entityId: idResult.value,
        });
      }

      await Promise.all(
        attachmentsToCleanup.map((attachment) =>
          deleteSupplierQuoteAttachment(attachment.storedName).catch((err) => {
            attachmentsLogger.warn(
              { err, storedName: attachment.storedName },
              'Failed to remove attachment file during quote delete',
            );
          }),
        ),
      );

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
