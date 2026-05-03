import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withDbTransaction } from '../db/drizzle.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as supplierInvoicesRepo from '../repositories/supplierInvoicesRepo.ts';
import * as supplierOrdersRepo from '../repositories/supplierOrdersRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { type DatabaseError, getUniqueViolation } from '../utils/db-errors.ts';
import { generateItemId } from '../utils/order-ids.ts';
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

const isSupplierInvoiceIdConflict = (databaseError: DatabaseError) =>
  databaseError.constraint === 'supplier_invoices_pkey' || databaseError.detail?.includes('(id)');

const duplicateInvoiceError = (databaseError: DatabaseError) => {
  if (databaseError.constraint === 'idx_supplier_invoices_linked_sale_id_unique') {
    return 'An invoice already exists for this order';
  }
  if (databaseError.constraint === 'supplier_invoices_pkey') {
    return 'Invoice ID already exists';
  }
  if (databaseError.detail?.includes('(linked_sale_id)')) {
    return 'An invoice already exists for this order';
  }
  if (databaseError.detail?.includes('(id)')) {
    return 'Invoice ID already exists';
  }
  return 'Invoice ID already exists';
};

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const invoiceItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    invoiceId: { type: 'string' },
    productId: { type: ['string', 'null'] },
    description: { type: 'string' },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    discount: { type: 'number' },
  },
  required: ['id', 'invoiceId', 'description', 'quantity', 'unitPrice', 'discount'],
} as const;

const invoiceSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    linkedSaleId: { type: ['string', 'null'] },
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    issueDate: { type: 'string', format: 'date' },
    dueDate: { type: 'string', format: 'date' },
    status: { type: 'string' },
    subtotal: { type: 'number' },
    total: { type: 'number' },
    amountPaid: { type: 'number' },
    notes: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    items: { type: 'array', items: invoiceItemSchema },
  },
  required: [
    'id',
    'supplierId',
    'supplierName',
    'issueDate',
    'dueDate',
    'status',
    'subtotal',
    'total',
    'amountPaid',
    'createdAt',
    'updatedAt',
    'items',
  ],
} as const;

const invoiceItemBodySchema = {
  type: 'object',
  properties: {
    productId: { type: 'string' },
    description: { type: 'string' },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    discount: { type: 'number' },
  },
  required: ['description', 'quantity', 'unitPrice'],
} as const;

const createBodySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    linkedSaleId: { type: 'string' },
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    issueDate: { type: 'string', format: 'date' },
    dueDate: { type: 'string', format: 'date' },
    status: { type: 'string' },
    subtotal: { type: 'number' },
    total: { type: 'number' },
    amountPaid: { type: 'number' },
    notes: { type: 'string' },
    items: { type: 'array', items: invoiceItemBodySchema },
  },
  required: ['supplierId', 'supplierName', 'issueDate', 'dueDate', 'items'],
} as const;

const updateBodySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    issueDate: { type: 'string', format: 'date' },
    dueDate: { type: 'string', format: 'date' },
    status: { type: 'string' },
    subtotal: { type: 'number' },
    total: { type: 'number' },
    amountPaid: { type: 'number' },
    notes: { type: 'string' },
    items: { type: 'array', items: invoiceItemBodySchema },
  },
} as const;

type SupplierInvoiceItemInput = {
  productId?: string;
  description?: string;
  quantity?: string | number;
  unitPrice?: string | number;
  discount?: string | number;
};

const normalizeItems = (
  items: SupplierInvoiceItemInput[],
  reply: FastifyReply,
): supplierInvoicesRepo.NewSupplierInvoiceItem[] | null => {
  const normalizedItems: supplierInvoicesRepo.NewSupplierInvoiceItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const descriptionResult = requireNonEmptyString(item.description, `items[${i}].description`);
    if (!descriptionResult.ok) {
      badRequest(reply, descriptionResult.message);
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
    const discountResult = optionalLocalizedNonNegativeNumber(
      item.discount,
      `items[${i}].discount`,
    );
    if (!discountResult.ok) {
      badRequest(reply, discountResult.message);
      return null;
    }
    normalizedItems.push({
      id: generateItemId('sinv-item-'),
      productId: item.productId || null,
      description: descriptionResult.value,
      quantity: quantityResult.value,
      unitPrice: unitPriceResult.value,
      discount: discountResult.value || 0,
    });
  }
  return normalizedItems;
};

const generateSupplierInvoiceId = async (issueDate: string) => {
  const year = issueDate.split('-')[0];
  const maxSequence = await supplierInvoicesRepo.maxSequenceForYear(year);
  const nextSequence = maxSequence + 1;
  return `SINV-${year}-${String(nextSequence).padStart(4, '0')}`;
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.addHook('onRequest', authenticateToken);

  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('accounting.supplier_invoices.view'),
      ],
      schema: {
        tags: ['supplier-invoices'],
        summary: 'List supplier invoices',
        response: {
          200: { type: 'array', items: invoiceSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async () => {
      const [invoices, items] = await Promise.all([
        supplierInvoicesRepo.listAll(),
        supplierInvoicesRepo.listAllItems(),
      ]);
      const itemsByInvoice: Record<string, supplierInvoicesRepo.SupplierInvoiceItem[]> = {};
      for (const item of items) {
        if (!itemsByInvoice[item.invoiceId]) itemsByInvoice[item.invoiceId] = [];
        itemsByInvoice[item.invoiceId].push(item);
      }
      return invoices.map((invoice) => ({
        ...invoice,
        items: itemsByInvoice[invoice.id] || [],
      }));
    },
  );

  fastify.post(
    '/',
    {
      onRequest: [requirePermission('accounting.supplier_invoices.create')],
      schema: {
        tags: ['supplier-invoices'],
        summary: 'Create supplier invoice',
        body: createBodySchema,
        response: {
          201: invoiceSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        id: nextId,
        linkedSaleId,
        supplierId,
        supplierName,
        issueDate,
        dueDate,
        status,
        subtotal,
        total,
        amountPaid,
        notes,
        items,
      } = request.body as {
        id?: unknown;
        linkedSaleId?: unknown;
        supplierId: unknown;
        supplierName: unknown;
        issueDate: unknown;
        dueDate: unknown;
        status: unknown;
        subtotal: unknown;
        total: unknown;
        amountPaid: unknown;
        notes: unknown;
        items: SupplierInvoiceItemInput[] | unknown;
      };

      const supplierIdResult = requireNonEmptyString(supplierId, 'supplierId');
      if (!supplierIdResult.ok) return badRequest(reply, supplierIdResult.message);

      const supplierNameResult = requireNonEmptyString(supplierName, 'supplierName');
      if (!supplierNameResult.ok) return badRequest(reply, supplierNameResult.message);
      const nextIdResult = optionalNonEmptyString(nextId, 'id');
      if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);

      const issueDateResult = parseDateString(issueDate, 'issueDate');
      if (!issueDateResult.ok) return badRequest(reply, issueDateResult.message);

      const dueDateResult = parseDateString(dueDate, 'dueDate');
      if (!dueDateResult.ok) return badRequest(reply, dueDateResult.message);

      if (dueDateResult.value < issueDateResult.value) {
        return badRequest(reply, 'dueDate must be on or after issueDate');
      }

      if (!Array.isArray(items) || items.length === 0) {
        return badRequest(reply, 'Items must be a non-empty array');
      }

      const normalizedItems = normalizeItems(items, reply);
      if (!normalizedItems) return;

      const linkedSaleIdResult = optionalNonEmptyString(linkedSaleId, 'linkedSaleId');
      if (!linkedSaleIdResult.ok) return badRequest(reply, linkedSaleIdResult.message);

      const subtotalResult = optionalLocalizedNonNegativeNumber(subtotal, 'subtotal');
      if (!subtotalResult.ok) return badRequest(reply, subtotalResult.message);
      const totalResult = optionalLocalizedNonNegativeNumber(total, 'total');
      if (!totalResult.ok) return badRequest(reply, totalResult.message);
      const amountPaidResult = optionalLocalizedNonNegativeNumber(amountPaid, 'amountPaid');
      if (!amountPaidResult.ok) return badRequest(reply, amountPaidResult.message);

      if (linkedSaleIdResult.value) {
        const [sourceOrder, existingInvoiceId] = await Promise.all([
          supplierOrdersRepo.findById(linkedSaleIdResult.value),
          supplierInvoicesRepo.findInvoiceForLinkedSale(linkedSaleIdResult.value),
        ]);
        if (!sourceOrder) {
          return reply.code(404).send({ error: 'Source order not found' });
        }
        if (sourceOrder.status !== 'sent') {
          return reply.code(409).send({ error: 'Invoices can only be created from sent orders' });
        }
        if (existingInvoiceId) {
          return reply.code(409).send({ error: 'An invoice already exists for this order' });
        }
      }

      const maxInsertAttempts = nextIdResult.value ? 1 : 5;

      let resolvedInvoiceId: string | null = nextIdResult.value;
      let result: {
        invoice: supplierInvoicesRepo.SupplierInvoice;
        items: supplierInvoicesRepo.SupplierInvoiceItem[];
      } | null = null;

      try {
        for (let attempt = 0; attempt < maxInsertAttempts; attempt++) {
          if (!resolvedInvoiceId) {
            resolvedInvoiceId = await generateSupplierInvoiceId(issueDateResult.value);
          }

          try {
            const idForAttempt = resolvedInvoiceId;
            result = await withDbTransaction(async (tx) => {
              const invoice = await supplierInvoicesRepo.create(
                {
                  id: idForAttempt,
                  linkedSaleId: linkedSaleIdResult.value || null,
                  supplierId: supplierIdResult.value,
                  supplierName: supplierNameResult.value,
                  issueDate: issueDateResult.value,
                  dueDate: dueDateResult.value,
                  status: typeof status === 'string' && status.length > 0 ? status : 'draft',
                  subtotal: subtotalResult.value || 0,
                  total: totalResult.value || 0,
                  amountPaid: amountPaidResult.value || 0,
                  notes: typeof notes === 'string' ? notes : null,
                },
                tx,
              );
              const createdItems = await supplierInvoicesRepo.insertItems(
                invoice.id,
                normalizedItems,
                tx,
              );
              return { invoice, items: createdItems };
            });
            break;
          } catch (error) {
            const dup = getUniqueViolation(error);
            if (
              !nextIdResult.value &&
              dup &&
              isSupplierInvoiceIdConflict(dup) &&
              attempt < maxInsertAttempts - 1
            ) {
              resolvedInvoiceId = null;
              continue;
            }
            throw error;
          }
        }

        if (!result) {
          return reply.code(409).send({ error: 'Invoice ID already exists' });
        }

        await logAudit({
          request,
          action: 'supplier_invoice.created',
          entityType: 'supplier_invoice',
          entityId: result.invoice.id,
          details: {
            targetLabel: result.invoice.id,
            secondaryLabel: result.invoice.supplierName,
          },
        });
        return reply.code(201).send({
          ...result.invoice,
          items: result.items,
        });
      } catch (error) {
        const dup = getUniqueViolation(error);
        if (dup) return reply.code(409).send({ error: duplicateInvoiceError(dup) });
        throw error;
      }
    },
  );

  fastify.put(
    '/:id',
    {
      onRequest: [requirePermission('accounting.supplier_invoices.update')],
      schema: {
        tags: ['supplier-invoices'],
        summary: 'Update supplier invoice',
        params: idParamSchema,
        body: updateBodySchema,
        response: {
          200: invoiceSchema,
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
        issueDate,
        dueDate,
        status,
        subtotal,
        total,
        amountPaid,
        notes,
        items,
      } = request.body as {
        id: unknown;
        supplierId: unknown;
        supplierName: unknown;
        issueDate: unknown;
        dueDate: unknown;
        status: unknown;
        subtotal: unknown;
        total: unknown;
        amountPaid: unknown;
        notes: unknown;
        items: SupplierInvoiceItemInput[] | unknown;
      };

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const patch: supplierInvoicesRepo.SupplierInvoiceUpdate = {};

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

      if (issueDate !== undefined) {
        const issueDateResult = optionalDateString(issueDate, 'issueDate');
        if (!issueDateResult.ok) return badRequest(reply, issueDateResult.message);
        if (issueDateResult.value !== null) patch.issueDate = issueDateResult.value;
      }

      if (dueDate !== undefined) {
        const dueDateResult = optionalDateString(dueDate, 'dueDate');
        if (!dueDateResult.ok) return badRequest(reply, dueDateResult.message);
        if (dueDateResult.value !== null) patch.dueDate = dueDateResult.value;
      }

      const [existingInvoice, idConflict] = await Promise.all([
        supplierInvoicesRepo.findExistingForUpdate(idResult.value),
        nextIdValue
          ? supplierInvoicesRepo.findIdConflict(nextIdValue, idResult.value)
          : Promise.resolve(false),
      ]);

      if (!existingInvoice) {
        return reply.code(404).send({ error: 'Invoice not found' });
      }
      if (idConflict) {
        return reply.code(409).send({ error: 'Invoice ID already exists' });
      }
      if (nextIdValue !== null) patch.id = nextIdValue;

      const hasLockedFieldUpdates =
        supplierId !== undefined ||
        supplierName !== undefined ||
        issueDate !== undefined ||
        dueDate !== undefined ||
        subtotal !== undefined ||
        total !== undefined ||
        amountPaid !== undefined ||
        notes !== undefined ||
        items !== undefined;
      if (existingInvoice.status !== 'draft' && hasLockedFieldUpdates) {
        return reply.code(409).send({
          error: 'Non-draft invoices are read-only',
          currentStatus: existingInvoice.status,
        });
      }

      const effectiveIssueDate = patch.issueDate ?? existingInvoice.issueDate;
      const effectiveDueDate = patch.dueDate ?? existingInvoice.dueDate;

      if (effectiveDueDate < effectiveIssueDate) {
        return badRequest(reply, 'dueDate must be on or after issueDate');
      }

      if (subtotal !== undefined) {
        const subtotalResult = optionalLocalizedNonNegativeNumber(subtotal, 'subtotal');
        if (!subtotalResult.ok) return badRequest(reply, subtotalResult.message);
        if (subtotalResult.value !== null) patch.subtotal = subtotalResult.value;
      }

      if (total !== undefined) {
        const totalResult = optionalLocalizedNonNegativeNumber(total, 'total');
        if (!totalResult.ok) return badRequest(reply, totalResult.message);
        if (totalResult.value !== null) patch.total = totalResult.value;
      }

      if (amountPaid !== undefined) {
        const amountPaidResult = optionalLocalizedNonNegativeNumber(amountPaid, 'amountPaid');
        if (!amountPaidResult.ok) return badRequest(reply, amountPaidResult.message);
        if (amountPaidResult.value !== null) patch.amountPaid = amountPaidResult.value;
      }

      if (typeof status === 'string') patch.status = status;
      if (typeof notes === 'string') patch.notes = notes;

      let normalizedItems: supplierInvoicesRepo.NewSupplierInvoiceItem[] | null = null;
      if (items !== undefined) {
        if (!Array.isArray(items) || items.length === 0) {
          return badRequest(reply, 'Items must be a non-empty array');
        }
        normalizedItems = normalizeItems(items, reply);
        if (!normalizedItems) return;
      }

      let updated: supplierInvoicesRepo.SupplierInvoice | null;
      let resultItems: supplierInvoicesRepo.SupplierInvoiceItem[];
      try {
        const txResult = await withDbTransaction(async (tx) => {
          const invoice = await supplierInvoicesRepo.update(idResult.value, patch, tx);
          if (!invoice)
            return { invoice: null, items: [] as supplierInvoicesRepo.SupplierInvoiceItem[] };
          const finalItems = normalizedItems
            ? await supplierInvoicesRepo.replaceItems(invoice.id, normalizedItems, tx)
            : await supplierInvoicesRepo.findItemsForInvoice(invoice.id, tx);
          return { invoice, items: finalItems };
        });
        updated = txResult.invoice;
        resultItems = txResult.items;
      } catch (error) {
        const dup = getUniqueViolation(error);
        if (dup) return reply.code(409).send({ error: duplicateInvoiceError(dup) });
        throw error;
      }

      if (!updated) {
        return reply.code(404).send({ error: 'Invoice not found' });
      }

      const didStatusChange =
        typeof status === 'string' && existingInvoice.status !== updated.status;
      await logAudit({
        request,
        action: 'supplier_invoice.updated',
        entityType: 'supplier_invoice',
        entityId: updated.id,
        details: {
          targetLabel: updated.id,
          secondaryLabel: updated.supplierName,
          fromValue: didStatusChange ? existingInvoice.status : undefined,
          toValue: didStatusChange ? updated.status : undefined,
        },
      });
      return {
        ...updated,
        items: resultItems,
      };
    },
  );

  fastify.delete(
    '/:id',
    {
      onRequest: [requirePermission('accounting.supplier_invoices.delete')],
      schema: {
        tags: ['supplier-invoices'],
        summary: 'Delete supplier invoice',
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

      const existing = await supplierInvoicesRepo.findStatusAndSupplierName(idResult.value);
      if (!existing) {
        return reply.code(404).send({ error: 'Invoice not found' });
      }
      if (existing.status !== 'draft') {
        return reply.code(409).send({ error: 'Only draft invoices can be deleted' });
      }

      await supplierInvoicesRepo.deleteById(idResult.value);

      await logAudit({
        request,
        action: 'supplier_invoice.deleted',
        entityType: 'supplier_invoice',
        entityId: idResult.value,
        details: {
          targetLabel: idResult.value,
          secondaryLabel: existing.supplierName,
        },
      });
      return reply.code(204).send();
    },
  );
}
