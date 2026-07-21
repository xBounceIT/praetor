import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withDbTransaction } from '../db/drizzle.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as supplierInvoicesRepo from '../repositories/supplierInvoicesRepo.ts';
import * as supplierOrdersRepo from '../repositories/supplierOrdersRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import {
  allocateDocumentCode,
  compactDocumentCodeSources,
  reserveDocumentCodeCounterFromCode,
} from '../services/documentCodes.ts';
import { logAudit } from '../utils/audit.ts';
import { type DatabaseError, getUniqueViolation } from '../utils/db-errors.ts';
import { replyDocumentCodeCollision } from '../utils/document-code-replies.ts';
import { roundCurrency } from '../utils/invoice-math.ts';
import { generatePrefixedId, ITEM_ID_PREFIXES } from '../utils/order-ids.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { replyError } from '../utils/replyError.ts';
import {
  legacyDiscountRoundingForWrite,
  preserveLegacyDiscountRounding,
} from '../utils/supplier-discount-rounding.ts';
import {
  badRequest,
  optionalDateString,
  optionalDurationMonths,
  optionalDurationUnit,
  optionalLocalizedNonNegativeNumber,
  optionalNonEmptyString,
  parseDateString,
  parseLocalizedNonNegativeNumber,
  parseLocalizedPositiveNumber,
  requireNonEmptyString,
} from '../utils/validation.ts';

const AMOUNT_PAID_EXCEEDS_TOTAL_ERROR = 'amountPaid cannot exceed total';
const PAID_INVOICE_UNDERPAID_ERROR = 'amountPaid must be at least total when status is paid';

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
    legacyDiscountRounding: { type: 'boolean' },
    durationMonths: { type: 'number' },
    durationUnit: { type: 'string', enum: ['months', 'years', 'na'] },
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
    id: { type: 'string' },
    productId: { type: 'string' },
    description: { type: 'string' },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    discount: { type: 'number', minimum: 0, maximum: 100 },
    legacyDiscountRounding: { type: 'boolean' },
    durationMonths: { type: 'number' },
    durationUnit: { type: 'string', enum: ['months', 'years', 'na'] },
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
  id?: string;
  productId?: string;
  description?: string;
  quantity?: string | number;
  unitPrice?: string | number;
  discount?: string | number;
  legacyDiscountRounding?: boolean;
  durationMonths?: string | number;
  durationUnit?: string;
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
    const durationMonthsResult = optionalDurationMonths(
      item.durationMonths,
      `items[${i}].durationMonths`,
    );
    if (!durationMonthsResult.ok) {
      badRequest(reply, durationMonthsResult.message);
      return null;
    }
    const durationUnitResult = optionalDurationUnit(item.durationUnit, `items[${i}].durationUnit`);
    if (!durationUnitResult.ok) {
      badRequest(reply, durationUnitResult.message);
      return null;
    }
    normalizedItems.push({
      id: generatePrefixedId(ITEM_ID_PREFIXES.supplierInvoiceItem),
      productId: item.productId || null,
      description: descriptionResult.value,
      quantity: quantityResult.value,
      unitPrice: unitPriceResult.value,
      discount: discountResult.value || 0,
      legacyDiscountRounding: legacyDiscountRoundingForWrite(
        item.legacyDiscountRounding,
        discountResult.value || 0,
      ),
      // Duration applies to every line type (issue #775); 'na' is gated via effectiveDurationMonths.
      durationMonths: durationMonthsResult.value ?? 1,
      durationUnit: durationUnitResult.value ?? 'months',
    });
  }
  return normalizedItems;
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
      const subtotalValue = roundCurrency(subtotalResult.value ?? 0);
      const totalValue = roundCurrency(totalResult.value ?? 0);
      const amountPaidValue = roundCurrency(amountPaidResult.value ?? 0);
      const statusValue = typeof status === 'string' && status.length > 0 ? status : 'draft';

      if (amountPaidValue > totalValue) {
        return badRequest(reply, AMOUNT_PAID_EXCEEDS_TOTAL_ERROR);
      }
      if (statusValue === 'paid' && amountPaidValue < totalValue) {
        return badRequest(reply, PAID_INVOICE_UNDERPAID_ERROR);
      }

      if (linkedSaleIdResult.value) {
        const [sourceOrder, existingInvoiceId] = await Promise.all([
          supplierOrdersRepo.findById(linkedSaleIdResult.value),
          supplierInvoicesRepo.findInvoiceForLinkedSale(linkedSaleIdResult.value),
        ]);
        if (!sourceOrder) {
          return replyError(request, reply, {
            statusCode: 404,
            message: 'Source order not found',
            action: 'supplier_invoice.create.not_found',
            entityType: 'supplier_order',
            entityId: linkedSaleIdResult.value,
          });
        }
        if (sourceOrder.status !== 'sent') {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'Invoices can only be created from sent orders',
            action: 'supplier_invoice.create.conflict',
            entityType: 'supplier_order',
            entityId: linkedSaleIdResult.value,
            details: { secondaryLabel: 'source_order_not_sent', fromValue: sourceOrder.status },
          });
        }
        if (existingInvoiceId) {
          return replyError(request, reply, {
            statusCode: 409,
            message: 'An invoice already exists for this order',
            action: 'supplier_invoice.create.conflict',
            entityType: 'supplier_order',
            entityId: linkedSaleIdResult.value,
            details: { secondaryLabel: 'duplicate_invoice_for_order' },
          });
        }
      }

      let result: {
        invoice: supplierInvoicesRepo.SupplierInvoice;
        items: supplierInvoicesRepo.SupplierInvoiceItem[];
      } | null = null;

      try {
        type CreateOutcome =
          | { ok: false; status: number; body: Record<string, unknown> }
          | {
              ok: true;
              invoice: supplierInvoicesRepo.SupplierInvoice;
              items: supplierInvoicesRepo.SupplierInvoiceItem[];
            };
        const txResult = await withDbTransaction(async (tx): Promise<CreateOutcome> => {
          let lockedSourceOrder: { id: string; linkedQuoteId: string | null } | null = null;
          // Lock the linked supplier order so a concurrent supplier-order restore
          // (which gates on "no linked invoice exists") serializes against this insert.
          if (linkedSaleIdResult.value) {
            const lockedOrder = await supplierOrdersRepo.lockExistingById(
              linkedSaleIdResult.value,
              tx,
            );
            if (!lockedOrder) {
              return { ok: false, status: 404, body: { error: 'Source order not found' } };
            }
            if (lockedOrder.status !== 'sent') {
              return {
                ok: false,
                status: 409,
                body: { error: 'Invoices can only be created from sent orders' },
              };
            }
            const existingInvoiceId = await supplierInvoicesRepo.findInvoiceForLinkedSale(
              linkedSaleIdResult.value,
              tx,
            );
            if (existingInvoiceId) {
              return {
                ok: false,
                status: 409,
                body: { error: 'An invoice already exists for this order' },
              };
            }
            lockedSourceOrder = lockedOrder;
          }

          let invoiceId: string;
          if (nextIdResult.value) {
            await reserveDocumentCodeCounterFromCode('supplier_invoice', nextIdResult.value, tx);
            invoiceId = nextIdResult.value;
          } else {
            const sourceCodes = compactDocumentCodeSources(
              lockedSourceOrder?.linkedQuoteId,
              lockedSourceOrder?.id ?? linkedSaleIdResult.value,
            );
            invoiceId = await allocateDocumentCode('supplier_invoice', {
              date: issueDateResult.value,
              exec: tx,
              ...(sourceCodes.length ? { sourceCodes } : {}),
            });
          }
          const invoice = await supplierInvoicesRepo.create(
            {
              id: invoiceId,
              linkedSaleId: linkedSaleIdResult.value || null,
              supplierId: supplierIdResult.value,
              supplierName: supplierNameResult.value,
              issueDate: issueDateResult.value,
              dueDate: dueDateResult.value,
              status: statusValue,
              subtotal: subtotalValue,
              total: totalValue,
              amountPaid: amountPaidValue,
              notes: typeof notes === 'string' ? notes : null,
            },
            tx,
          );
          const createdItems = await supplierInvoicesRepo.insertItems(
            invoice.id,
            normalizedItems,
            tx,
          );
          return { ok: true, invoice, items: createdItems };
        });
        if (!txResult.ok) {
          return reply.code(txResult.status).send(txResult.body);
        }
        result = { invoice: txResult.invoice, items: txResult.items };

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
        const codeCollision = replyDocumentCodeCollision(
          request,
          reply,
          error,
          'supplier_invoice.create.conflict',
          'supplier_invoice',
        );
        if (codeCollision) return codeCollision;
        const dup = getUniqueViolation(error);
        if (dup) {
          return replyError(request, reply, {
            statusCode: 409,
            message: duplicateInvoiceError(dup),
            action: 'supplier_invoice.create.conflict',
            entityType: 'supplier_invoice',
            details: { secondaryLabel: 'unique_violation' },
          });
        }
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
        supplierInvoicesRepo.findExisting(idResult.value),
        nextIdValue
          ? supplierInvoicesRepo.findIdConflict(nextIdValue, idResult.value)
          : Promise.resolve(false),
      ]);

      if (!existingInvoice) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Invoice not found',
          action: 'supplier_invoice.update.not_found',
          entityType: 'supplier_invoice',
          entityId: idResult.value,
        });
      }
      if (idConflict) {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Invoice ID already exists',
          action: 'supplier_invoice.update.conflict',
          entityType: 'supplier_invoice',
          entityId: idResult.value,
          details: { secondaryLabel: 'duplicate_id' },
        });
      }
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
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Non-draft invoices are read-only',
          action: 'supplier_invoice.update.conflict',
          entityType: 'supplier_invoice',
          entityId: idResult.value,
          details: { secondaryLabel: 'non_draft_read_only', fromValue: existingInvoice.status },
          extraBody: { currentStatus: existingInvoice.status },
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
        if (subtotalResult.value !== null) patch.subtotal = roundCurrency(subtotalResult.value);
      }

      if (total !== undefined) {
        const totalResult = optionalLocalizedNonNegativeNumber(total, 'total');
        if (!totalResult.ok) return badRequest(reply, totalResult.message);
        if (totalResult.value !== null) patch.total = roundCurrency(totalResult.value);
      }

      if (amountPaid !== undefined) {
        const amountPaidResult = optionalLocalizedNonNegativeNumber(amountPaid, 'amountPaid');
        if (!amountPaidResult.ok) return badRequest(reply, amountPaidResult.message);
        if (amountPaidResult.value !== null)
          patch.amountPaid = roundCurrency(amountPaidResult.value);
      }

      if (typeof status === 'string') patch.status = status;
      if (typeof notes === 'string') patch.notes = notes;

      const effectiveTotal = patch.total ?? existingInvoice.total;
      const effectiveAmountPaid = patch.amountPaid ?? existingInvoice.amountPaid;
      if (
        (patch.total !== undefined || patch.amountPaid !== undefined || patch.status === 'paid') &&
        effectiveAmountPaid > effectiveTotal
      ) {
        return badRequest(reply, AMOUNT_PAID_EXCEEDS_TOTAL_ERROR);
      }
      if (patch.status === 'paid' && effectiveAmountPaid < effectiveTotal) {
        return badRequest(reply, PAID_INVOICE_UNDERPAID_ERROR);
      }

      let normalizedItems: supplierInvoicesRepo.NewSupplierInvoiceItem[] | null = null;
      let itemInputs: SupplierInvoiceItemInput[] | null = null;
      if (items !== undefined) {
        if (!Array.isArray(items) || items.length === 0) {
          return badRequest(reply, 'Items must be a non-empty array');
        }
        itemInputs = items;
        normalizedItems = normalizeItems(itemInputs, reply);
        if (!normalizedItems) return;
      }

      let updated: supplierInvoicesRepo.SupplierInvoice | null;
      let resultItems: supplierInvoicesRepo.SupplierInvoiceItem[];
      try {
        const txResult = await withDbTransaction(async (tx) => {
          let renamedInvoice: supplierInvoicesRepo.SupplierInvoice | null = null;
          if (nextIdValue && nextIdValue !== idResult.value) {
            renamedInvoice = await supplierInvoicesRepo.rename(idResult.value, nextIdValue, tx);
            if (!renamedInvoice) {
              return { invoice: null, items: [] as supplierInvoicesRepo.SupplierInvoiceItem[] };
            }
            await reserveDocumentCodeCounterFromCode('supplier_invoice', nextIdValue, tx);
          }
          // id-only renames have nothing left to write — reuse the row returned by rename().
          const invoice =
            Object.keys(patch).length === 0 && renamedInvoice
              ? renamedInvoice
              : await supplierInvoicesRepo.update(renamedInvoice?.id ?? idResult.value, patch, tx);
          if (!invoice)
            return { invoice: null, items: [] as supplierInvoicesRepo.SupplierInvoiceItem[] };
          const existingItems =
            normalizedItems && itemInputs?.some((item) => item.legacyDiscountRounding === undefined)
              ? await supplierInvoicesRepo.findItemsForInvoice(invoice.id, tx)
              : null;
          const replacementItems =
            normalizedItems && itemInputs && existingItems
              ? preserveLegacyDiscountRounding(normalizedItems, itemInputs, existingItems)
              : normalizedItems;
          const finalItems = replacementItems
            ? await supplierInvoicesRepo.replaceItems(invoice.id, replacementItems, tx)
            : await supplierInvoicesRepo.findItemsForInvoice(invoice.id, tx);
          return { invoice, items: finalItems };
        });
        updated = txResult.invoice;
        resultItems = txResult.items;
      } catch (error) {
        const dup = getUniqueViolation(error);
        if (dup) {
          return replyError(request, reply, {
            statusCode: 409,
            message: duplicateInvoiceError(dup),
            action: 'supplier_invoice.update.conflict',
            entityType: 'supplier_invoice',
            entityId: idResult.value,
            details: { secondaryLabel: 'unique_violation' },
          });
        }
        throw error;
      }

      if (!updated) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Invoice not found',
          action: 'supplier_invoice.update.not_found',
          entityType: 'supplier_invoice',
          entityId: idResult.value,
        });
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
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Invoice not found',
          action: 'supplier_invoice.delete.not_found',
          entityType: 'supplier_invoice',
          entityId: idResult.value,
        });
      }
      if (existing.status !== 'draft') {
        return replyError(request, reply, {
          statusCode: 409,
          message: 'Only draft invoices can be deleted',
          action: 'supplier_invoice.delete.conflict',
          entityType: 'supplier_invoice',
          entityId: idResult.value,
          details: { secondaryLabel: 'non_draft_status', fromValue: existing.status },
        });
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
