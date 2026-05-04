import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withDbTransaction } from '../db/drizzle.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as invoicesRepo from '../repositories/invoicesRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { getForeignKeyViolation, getUniqueViolation } from '../utils/db-errors.ts';
import { computeInvoiceTotals } from '../utils/invoice-math.ts';
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
  validateEnum,
} from '../utils/validation.ts';

const UNIT_OF_MEASURE_VALUES = ['unit', 'hours'] as const;

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
    unitOfMeasure: { type: 'string', enum: [...UNIT_OF_MEASURE_VALUES] },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    discount: { type: 'number' },
  },
  required: [
    'id',
    'invoiceId',
    'description',
    'unitOfMeasure',
    'quantity',
    'unitPrice',
    'discount',
  ],
} as const;

const invoiceSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    linkedSaleId: { type: ['string', 'null'] },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
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
    'clientId',
    'clientName',
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
    unitOfMeasure: { type: 'string', enum: [...UNIT_OF_MEASURE_VALUES] },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    discount: { type: 'number' },
  },
  required: ['description', 'unitOfMeasure', 'quantity', 'unitPrice'],
} as const;

// subtotal/total are server-computed from items; clients cannot set them.
const invoiceCreateBodySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    linkedSaleId: { type: 'string' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    issueDate: { type: 'string', format: 'date' },
    dueDate: { type: 'string', format: 'date' },
    status: { type: 'string' },
    amountPaid: { type: 'number' },
    notes: { type: 'string' },
    items: { type: 'array', items: invoiceItemBodySchema },
  },
  required: ['clientId', 'clientName', 'issueDate', 'dueDate', 'items'],
} as const;

const invoiceUpdateBodySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    issueDate: { type: 'string', format: 'date' },
    dueDate: { type: 'string', format: 'date' },
    status: { type: 'string' },
    amountPaid: { type: 'number' },
    notes: { type: 'string' },
    items: { type: 'array', items: invoiceItemBodySchema },
  },
} as const;

type NormalizedInvoiceItemInput = {
  productId: string | null;
  description: string;
  unitOfMeasure: 'unit' | 'hours';
  quantity: number;
  unitPrice: number;
  discount: number;
};

const generateInvoiceItemId = () => generateItemId('inv-item-');

// Match the NUMERIC(_, 2) precision used for invoice_items columns so the totals computed
// here align with what would be re-derived from the persisted rows.
const round2 = (value: number) => Math.round(value * 100) / 100;

const validateAndNormalizeItems = (
  items: unknown[],
  reply: FastifyReply,
): NormalizedInvoiceItemInput[] | null => {
  const normalizedItems: NormalizedInvoiceItemInput[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i] as Record<string, unknown>;
    const productIdResult = optionalNonEmptyString(item.productId, `items[${i}].productId`);
    if (!productIdResult.ok) {
      badRequest(reply, productIdResult.message);
      return null;
    }

    const descriptionResult = requireNonEmptyString(item.description, `items[${i}].description`);
    if (!descriptionResult.ok) {
      badRequest(reply, descriptionResult.message);
      return null;
    }

    const unitOfMeasureResult = validateEnum(
      item.unitOfMeasure,
      [...UNIT_OF_MEASURE_VALUES],
      `items[${i}].unitOfMeasure`,
    );
    if (!unitOfMeasureResult.ok) {
      badRequest(reply, unitOfMeasureResult.message);
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
    // Without an upper bound a compromised client can send discount > 100, which makes
    // (1 - discount/100) negative and produces negative line totals — corrupting SUM(total)
    // in the revenue reports.
    if (discountResult.value !== null && discountResult.value > 100) {
      badRequest(reply, `items[${i}].discount must be at most 100`);
      return null;
    }

    normalizedItems.push({
      productId: productIdResult.value || null,
      description: descriptionResult.value,
      unitOfMeasure: unitOfMeasureResult.value as 'unit' | 'hours',
      quantity: round2(quantityResult.value),
      unitPrice: round2(unitPriceResult.value),
      discount: round2(discountResult.value || 0),
    });
  }

  return normalizedItems;
};

const buildItemsForInsert = (items: NormalizedInvoiceItemInput[]): invoicesRepo.NewInvoiceItem[] =>
  items.map((item) => ({
    id: generateInvoiceItemId(),
    productId: item.productId,
    description: item.description,
    unitOfMeasure: item.unitOfMeasure,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    discount: item.discount,
  }));

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // All invoices routes require authentication
  fastify.addHook('onRequest', authenticateToken);

  // GET / - List all invoices with their items
  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('accounting.clients_invoices.view'),
      ],
      schema: {
        tags: ['invoices'],
        summary: 'List invoices',
        response: {
          200: { type: 'array', items: invoiceSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      return invoicesRepo.listAllWithItems();
    },
  );

  // POST / - Create invoice with items
  fastify.post(
    '/',
    {
      onRequest: [requirePermission('accounting.clients_invoices.create')],
      schema: {
        tags: ['invoices'],
        summary: 'Create invoice',
        body: invoiceCreateBodySchema,
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
        clientId,
        clientName,
        issueDate,
        dueDate,
        status,
        amountPaid,
        notes,
        items,
      } = request.body as {
        id?: unknown;
        linkedSaleId: unknown;
        clientId: unknown;
        clientName: unknown;
        issueDate: unknown;
        dueDate: unknown;
        status: unknown;
        amountPaid: unknown;
        notes: unknown;
        items: unknown;
      };

      const clientIdResult = requireNonEmptyString(clientId, 'clientId');
      if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);

      const clientNameResult = requireNonEmptyString(clientName, 'clientName');
      if (!clientNameResult.ok) return badRequest(reply, clientNameResult.message);

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
      const normalizedItems = validateAndNormalizeItems(items, reply);
      if (!normalizedItems) return;

      const { subtotal: computedSubtotal, total: computedTotal } =
        computeInvoiceTotals(normalizedItems);

      const amountPaidResult = optionalLocalizedNonNegativeNumber(amountPaid, 'amountPaid');
      if (!amountPaidResult.ok) return badRequest(reply, amountPaidResult.message);
      const amountPaidValue = amountPaidResult.value || 0;
      if (amountPaidValue > computedTotal) {
        return badRequest(reply, 'amountPaid cannot exceed total');
      }

      const nextIdResult = optionalNonEmptyString(nextId, 'id');
      if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);
      const issueDateYear = issueDateResult.value.split('-')[0];
      const invoiceId = nextIdResult.value || (await invoicesRepo.generateNextId(issueDateYear));

      let result: { invoice: invoicesRepo.Invoice; items: invoicesRepo.InvoiceItem[] };
      try {
        result = await withDbTransaction(async (tx) => {
          const invoice = await invoicesRepo.create(
            {
              id: invoiceId,
              linkedSaleId: (linkedSaleId as string | null | undefined) || null,
              clientId: clientIdResult.value,
              clientName: clientNameResult.value,
              issueDate: issueDateResult.value,
              dueDate: dueDateResult.value,
              status: (status as string) || 'draft',
              subtotal: computedSubtotal,
              total: computedTotal,
              amountPaid: amountPaidValue,
              notes: (notes as string | null | undefined) ?? null,
            },
            tx,
          );
          const items = await invoicesRepo.insertItems(
            invoice.id,
            buildItemsForInsert(normalizedItems),
            tx,
          );
          return { invoice, items };
        });
      } catch (error) {
        const dup = getUniqueViolation(error);
        if (dup && (dup.constraint === 'invoices_pkey' || dup.detail?.includes('(id)'))) {
          return reply.code(409).send({ error: 'Invoice ID already exists' });
        }
        throw error;
      }

      const invoice = result.invoice;
      const createdItems = result.items;

      await logAudit({
        request,
        action: 'invoice.created',
        entityType: 'invoice',
        entityId: invoice.id,
        details: {
          targetLabel: invoice.id,
          secondaryLabel: clientNameResult.value,
        },
      });
      return reply.code(201).send({ ...invoice, items: createdItems });
    },
  );

  // PUT /:id - Update invoice
  fastify.put(
    '/:id',
    {
      onRequest: [requirePermission('accounting.clients_invoices.update')],
      schema: {
        tags: ['invoices'],
        summary: 'Update invoice',
        params: idParamSchema,
        body: invoiceUpdateBodySchema,
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
        clientId,
        clientName,
        issueDate,
        dueDate,
        status,
        amountPaid,
        notes,
        items,
      } = request.body as {
        id: unknown;
        clientId: unknown;
        clientName: unknown;
        issueDate: unknown;
        dueDate: unknown;
        status: unknown;
        amountPaid: unknown;
        notes: unknown;
        items: unknown;
      };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const patch: invoicesRepo.InvoiceUpdate = {};

      if (clientId !== undefined) {
        const clientIdResult = optionalNonEmptyString(clientId, 'clientId');
        if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);
        if (clientIdResult.value) patch.clientId = clientIdResult.value;
      }

      if (clientName !== undefined) {
        const clientNameResult = optionalNonEmptyString(clientName, 'clientName');
        if (!clientNameResult.ok) return badRequest(reply, clientNameResult.message);
        if (clientNameResult.value) patch.clientName = clientNameResult.value;
      }

      if (nextId !== undefined) {
        const nextIdResult = optionalNonEmptyString(nextId, 'id');
        if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);
        if (nextIdResult.value) {
          if (await invoicesRepo.findIdConflict(nextIdResult.value, idResult.value)) {
            return reply.code(409).send({ error: 'Invoice ID already exists' });
          }
          patch.id = nextIdResult.value;
        }
      }

      let nextIssueDate: string | undefined;
      if (issueDate !== undefined) {
        const issueDateResult = optionalDateString(issueDate, 'issueDate');
        if (!issueDateResult.ok) return badRequest(reply, issueDateResult.message);
        if (issueDateResult.value) {
          patch.issueDate = issueDateResult.value;
          nextIssueDate = issueDateResult.value;
        }
      }

      let nextDueDate: string | undefined;
      if (dueDate !== undefined) {
        const dueDateResult = optionalDateString(dueDate, 'dueDate');
        if (!dueDateResult.ok) return badRequest(reply, dueDateResult.message);
        if (dueDateResult.value) {
          patch.dueDate = dueDateResult.value;
          nextDueDate = dueDateResult.value;
        }
      }

      if (nextIssueDate !== undefined || nextDueDate !== undefined) {
        let effectiveIssueDate = nextIssueDate;
        let effectiveDueDate = nextDueDate;
        if (effectiveIssueDate === undefined || effectiveDueDate === undefined) {
          const persisted = await invoicesRepo.findDates(idResult.value);
          if (!persisted) {
            return reply.code(404).send({ error: 'Invoice not found' });
          }
          effectiveIssueDate = effectiveIssueDate ?? persisted.issueDate;
          effectiveDueDate = effectiveDueDate ?? persisted.dueDate;
        }
        if (effectiveDueDate < effectiveIssueDate) {
          return badRequest(reply, 'dueDate must be on or after issueDate');
        }
      }

      let amountPaidValue: number | undefined;
      if (amountPaid !== undefined) {
        const amountPaidResult = optionalLocalizedNonNegativeNumber(amountPaid, 'amountPaid');
        if (!amountPaidResult.ok) return badRequest(reply, amountPaidResult.message);
        amountPaidValue = amountPaidResult.value ?? undefined;
      }

      if (status !== undefined) patch.status = status as string;
      if (notes !== undefined) patch.notes = notes as string | null;

      let normalizedItemsForUpdate: NormalizedInvoiceItemInput[] | null = null;
      if (items) {
        if (!Array.isArray(items) || items.length === 0) {
          return badRequest(reply, 'Items must be a non-empty array');
        }
        normalizedItemsForUpdate = validateAndNormalizeItems(items, reply);
        if (!normalizedItemsForUpdate) return;
        const computed = computeInvoiceTotals(normalizedItemsForUpdate);
        patch.subtotal = computed.subtotal;
        patch.total = computed.total;
      }

      if (amountPaidValue !== undefined) {
        const totalForCheck = patch.total ?? (await invoicesRepo.findTotal(idResult.value));
        if (totalForCheck === null) {
          return reply.code(404).send({ error: 'Invoice not found' });
        }
        if (amountPaidValue > totalForCheck) {
          return badRequest(reply, 'amountPaid cannot exceed total');
        }
        patch.amountPaid = amountPaidValue;
      } else if (patch.total !== undefined) {
        // Items replaced (so total may be lower) but amountPaid not in this patch — verify the
        // persisted amountPaid still fits under the new total. Without this, paying-down to a
        // partial total would leave amountPaid > total and skew SUM(GREATEST(total - paid, 0)).
        const persistedAmountPaid = await invoicesRepo.findAmountPaid(idResult.value);
        if (persistedAmountPaid === null) {
          return reply.code(404).send({ error: 'Invoice not found' });
        }
        if (persistedAmountPaid > patch.total) {
          return badRequest(reply, 'amountPaid cannot exceed total');
        }
      }

      let result: {
        invoice: invoicesRepo.Invoice | null;
        items: invoicesRepo.InvoiceItem[];
      };
      try {
        result = await withDbTransaction(async (tx) => {
          const updated = await invoicesRepo.update(idResult.value, patch, tx);
          if (!updated) return { invoice: null, items: [] };
          const itemsOut = normalizedItemsForUpdate
            ? await invoicesRepo.replaceItems(
                updated.id,
                buildItemsForInsert(normalizedItemsForUpdate),
                tx,
              )
            : await invoicesRepo.findItemsForInvoice(updated.id, tx);
          return { invoice: updated, items: itemsOut };
        });
      } catch (error) {
        const dup = getUniqueViolation(error);
        if (dup && (dup.constraint === 'invoices_pkey' || dup.detail?.includes('(id)'))) {
          return reply.code(409).send({ error: 'Invoice ID already exists' });
        }
        throw error;
      }

      const invoice = result.invoice;
      const updatedItems = result.items;
      if (!invoice) {
        return reply.code(404).send({ error: 'Invoice not found' });
      }

      await logAudit({
        request,
        action: 'invoice.updated',
        entityType: 'invoice',
        entityId: invoice.id,
        details: {
          targetLabel: invoice.id,
          secondaryLabel: invoice.clientName,
        },
      });
      return { ...invoice, items: updatedItems };
    },
  );

  // DELETE /:id - Delete invoice
  fastify.delete(
    '/:id',
    {
      onRequest: [requirePermission('accounting.clients_invoices.delete')],
      schema: {
        tags: ['invoices'],
        summary: 'Delete invoice',
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

      // Invoice items will be deleted automatically via CASCADE
      try {
        const result = await invoicesRepo.deleteById(idResult.value);

        if (!result) {
          return reply.code(404).send({ error: 'Invoice not found' });
        }

        await logAudit({
          request,
          action: 'invoice.deleted',
          entityType: 'invoice',
          entityId: idResult.value,
          details: {
            targetLabel: idResult.value,
            secondaryLabel: result.clientName ?? '',
          },
        });
        return reply.code(204).send();
      } catch (err) {
        if (getForeignKeyViolation(err)) {
          return reply.code(409).send({
            error: 'Cannot delete invoice because it is referenced by other records',
          });
        }
        throw err;
      }
    },
  );
}
