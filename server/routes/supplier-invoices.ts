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
    taxRate: { type: 'number' },
    discount: { type: 'number' },
  },
  required: ['id', 'invoiceId', 'description', 'quantity', 'unitPrice', 'taxRate', 'discount'],
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
    taxAmount: { type: 'number' },
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
    'taxAmount',
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
    taxRate: { type: 'number' },
    discount: { type: 'number' },
  },
  required: ['description', 'quantity', 'unitPrice', 'taxRate'],
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
    taxAmount: { type: 'number' },
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
    taxAmount: { type: 'number' },
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
  taxRate?: string | number;
  discount?: string | number;
};

const normalizeItems = (items: SupplierInvoiceItemInput[], reply: FastifyReply) => {
  const normalizedItems: Array<Record<string, unknown>> = [];
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
    const taxRateResult = parseLocalizedNonNegativeNumber(item.taxRate, `items[${i}].taxRate`);
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
      description: descriptionResult.value,
      quantity: quantityResult.value,
      unitPrice: unitPriceResult.value,
      taxRate: taxRateResult.value,
      discount: discountResult.value || 0,
    });
  }
  return normalizedItems;
};

const toRequiredDateOnly = (value: unknown, fieldName: string) => {
  const normalizedDate = normalizeNullableDateOnly(value, fieldName);
  if (!normalizedDate) {
    throw new TypeError(`Invalid date value for ${fieldName}`);
  }
  return normalizedDate;
};

const generateSupplierInvoiceId = async (issueDate: string) => {
  const year = issueDate.split('-')[0];
  const matchingInvoicesResult = await query(
    `SELECT COALESCE(MAX(CAST(split_part(id, '-', 3) AS INTEGER)), 0) as "maxSequence"
     FROM supplier_invoices
     WHERE id ~ $1`,
    [`^SINV-${year}-[0-9]+$`],
  );
  const nextSequence = Number(matchingInvoicesResult.rows[0]?.maxSequence ?? 0) + 1;
  return `SINV-${year}-${String(nextSequence).padStart(4, '0')}`;
};

const formatInvoiceResponse = (
  invoice: {
    issueDate: string | Date;
    dueDate: string | Date;
    subtotal: string | number;
    taxAmount: string | number;
    total: string | number;
    amountPaid: string | number;
  } & Record<string, unknown>,
  items: Array<Record<string, unknown>>,
) => ({
  ...invoice,
  issueDate: toRequiredDateOnly(invoice.issueDate, 'supplierInvoice.issueDate'),
  dueDate: toRequiredDateOnly(invoice.dueDate, 'supplierInvoice.dueDate'),
  subtotal: Number(invoice.subtotal ?? 0),
  taxAmount: Number(invoice.taxAmount ?? 0),
  total: Number(invoice.total ?? 0),
  amountPaid: Number(invoice.amountPaid ?? 0),
  items: items.map((item) => ({
    ...item,
    quantity: Number(item.quantity ?? 0),
    unitPrice: Number(item.unitPrice ?? 0),
    taxRate: Number(item.taxRate ?? 0),
    discount: Number(item.discount ?? 0),
  })),
});

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
      const invoicesResult = await query(
        `SELECT
            si.id,
            si.linked_sale_id as "linkedSaleId",
            si.supplier_id as "supplierId",
            si.supplier_name as "supplierName",
            si.issue_date as "issueDate",
            si.due_date as "dueDate",
            si.status,
            si.subtotal,
            si.tax_amount as "taxAmount",
            si.total,
            si.amount_paid as "amountPaid",
            si.notes,
            EXTRACT(EPOCH FROM si.created_at) * 1000 as "createdAt",
            EXTRACT(EPOCH FROM si.updated_at) * 1000 as "updatedAt"
         FROM supplier_invoices si
         ORDER BY si.created_at DESC`,
      );

      const itemsResult = await query(
        `SELECT
            id,
            invoice_id as "invoiceId",
            product_id as "productId",
            description,
            quantity,
            unit_price as "unitPrice",
            tax_rate as "taxRate",
            discount
         FROM supplier_invoice_items
         ORDER BY created_at ASC`,
      );

      const itemsByInvoice: Record<string, Array<Record<string, unknown>>> = {};
      itemsResult.rows.forEach((item: { invoiceId: string } & Record<string, unknown>) => {
        if (!itemsByInvoice[item.invoiceId]) {
          itemsByInvoice[item.invoiceId] = [];
        }
        itemsByInvoice[item.invoiceId].push(item);
      });

      return invoicesResult.rows.map(
        (
          invoice: {
            id: string;
            issueDate: string | Date;
            dueDate: string | Date;
            subtotal: string | number;
            taxAmount: string | number;
            total: string | number;
            amountPaid: string | number;
          } & Record<string, unknown>,
        ) => formatInvoiceResponse(invoice, itemsByInvoice[invoice.id] || []),
      );
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
        taxAmount,
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
        taxAmount: unknown;
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
      const taxAmountResult = optionalLocalizedNonNegativeNumber(taxAmount, 'taxAmount');
      if (!taxAmountResult.ok) return badRequest(reply, taxAmountResult.message);
      const totalResult = optionalLocalizedNonNegativeNumber(total, 'total');
      if (!totalResult.ok) return badRequest(reply, totalResult.message);
      const amountPaidResult = optionalLocalizedNonNegativeNumber(amountPaid, 'amountPaid');
      if (!amountPaidResult.ok) return badRequest(reply, amountPaidResult.message);

      if (linkedSaleIdResult.value) {
        const orderResult = await query('SELECT id, status FROM supplier_sales WHERE id = $1', [
          linkedSaleIdResult.value,
        ]);
        if (orderResult.rows.length === 0) {
          return reply.code(404).send({ error: 'Source order not found' });
        }
        if (orderResult.rows[0].status !== 'confirmed') {
          return reply
            .code(409)
            .send({ error: 'Invoices can only be created from confirmed orders' });
        }

        const existingInvoiceResult = await query(
          'SELECT id FROM supplier_invoices WHERE linked_sale_id = $1 LIMIT 1',
          [linkedSaleIdResult.value],
        );
        if (existingInvoiceResult.rows.length > 0) {
          return reply.code(409).send({ error: 'An invoice already exists for this order' });
        }
      }

      const maxInsertAttempts = nextIdResult.value ? 1 : 5;

      try {
        let invoiceResult: Awaited<ReturnType<typeof query>> | null = null;
        let resolvedInvoiceId = nextIdResult.value;

        for (let attempt = 0; attempt < maxInsertAttempts; attempt++) {
          if (!resolvedInvoiceId) {
            resolvedInvoiceId = await generateSupplierInvoiceId(issueDateResult.value);
          }

          try {
            invoiceResult = await query(
              `INSERT INTO supplier_invoices
                (id, linked_sale_id, supplier_id, supplier_name, issue_date, due_date, status, subtotal, tax_amount, total, amount_paid, notes)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
               RETURNING
                  id,
                  linked_sale_id as "linkedSaleId",
                  supplier_id as "supplierId",
                  supplier_name as "supplierName",
                  issue_date as "issueDate",
                  due_date as "dueDate",
                  status,
                  subtotal,
                  tax_amount as "taxAmount",
                  total,
                  amount_paid as "amountPaid",
                  notes,
                  EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
                  EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
              [
                resolvedInvoiceId,
                linkedSaleIdResult.value || null,
                supplierIdResult.value,
                supplierNameResult.value,
                issueDateResult.value,
                dueDateResult.value,
                status || 'draft',
                subtotalResult.value || 0,
                taxAmountResult.value || 0,
                totalResult.value || 0,
                amountPaidResult.value || 0,
                notes || null,
              ],
            );
            break;
          } catch (error) {
            const databaseError = error as DatabaseError;
            if (
              !nextIdResult.value &&
              databaseError.code === '23505' &&
              isSupplierInvoiceIdConflict(databaseError) &&
              attempt < maxInsertAttempts - 1
            ) {
              resolvedInvoiceId = null;
              continue;
            }
            throw error;
          }
        }

        if (!invoiceResult || !resolvedInvoiceId) {
          return reply.code(409).send({ error: 'Invoice ID already exists' });
        }

        const createdItems: Array<Record<string, unknown>> = [];
        for (const item of normalizedItems) {
          const itemId = `sinv-item-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          const itemResult = await query(
            `INSERT INTO supplier_invoice_items
              (id, invoice_id, product_id, description, quantity, unit_price, tax_rate, discount)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING
                id,
                invoice_id as "invoiceId",
                product_id as "productId",
                description,
                quantity,
                unit_price as "unitPrice",
                tax_rate as "taxRate",
                discount`,
            [
              itemId,
              resolvedInvoiceId,
              item.productId || null,
              item.description,
              item.quantity,
              item.unitPrice,
              item.taxRate,
              item.discount || 0,
            ],
          );
          createdItems.push(itemResult.rows[0]);
        }

        await logAudit({
          request,
          action: 'supplier_invoice.created',
          entityType: 'supplier_invoice',
          entityId: resolvedInvoiceId,
          details: {
            targetLabel: resolvedInvoiceId,
            secondaryLabel: supplierNameResult.value,
          },
        });
        return reply.code(201).send(formatInvoiceResponse(invoiceResult.rows[0], createdItems));
      } catch (error) {
        const databaseError = error as DatabaseError;
        if (databaseError.code === '23505') {
          return reply.code(409).send({ error: duplicateInvoiceError(databaseError) });
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
        taxAmount,
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
        taxAmount: unknown;
        total: unknown;
        amountPaid: unknown;
        notes: unknown;
        items: SupplierInvoiceItemInput[] | unknown;
      };

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

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

      let nextIdValue = nextId;
      if (nextId !== undefined) {
        const nextIdResult = optionalNonEmptyString(nextId, 'id');
        if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);
        nextIdValue = nextIdResult.value;
        if (nextIdResult.value) {
          const existingIdResult = await query(
            'SELECT id FROM supplier_invoices WHERE id = $1 AND id <> $2',
            [nextIdResult.value, idResult.value],
          );
          if (existingIdResult.rows.length > 0) {
            return reply.code(409).send({ error: 'Invoice ID already exists' });
          }
        }
      }

      let issueDateValue = issueDate;
      if (issueDate !== undefined) {
        const issueDateResult = optionalDateString(issueDate, 'issueDate');
        if (!issueDateResult.ok) return badRequest(reply, issueDateResult.message);
        issueDateValue = issueDateResult.value;
      }

      let dueDateValue = dueDate;
      if (dueDate !== undefined) {
        const dueDateResult = optionalDateString(dueDate, 'dueDate');
        if (!dueDateResult.ok) return badRequest(reply, dueDateResult.message);
        dueDateValue = dueDateResult.value;
      }

      const existingInvoiceResult = await query(
        `SELECT
            id,
            status,
            issue_date as "issueDate",
            due_date as "dueDate"
         FROM supplier_invoices
         WHERE id = $1`,
        [idResult.value],
      );
      if (existingInvoiceResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Invoice not found' });
      }

      const existingInvoice = existingInvoiceResult.rows[0];
      const hasLockedFieldUpdates =
        supplierId !== undefined ||
        supplierName !== undefined ||
        issueDate !== undefined ||
        dueDate !== undefined ||
        subtotal !== undefined ||
        taxAmount !== undefined ||
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

      const effectiveIssueDate = toRequiredDateOnly(
        issueDateValue ?? existingInvoiceResult.rows[0].issueDate,
        'supplierInvoice.issueDate',
      );
      const effectiveDueDate = toRequiredDateOnly(
        dueDateValue ?? existingInvoiceResult.rows[0].dueDate,
        'supplierInvoice.dueDate',
      );

      if (effectiveDueDate < effectiveIssueDate) {
        return badRequest(reply, 'dueDate must be on or after issueDate');
      }

      let subtotalValue = subtotal;
      if (subtotal !== undefined) {
        const subtotalResult = optionalLocalizedNonNegativeNumber(subtotal, 'subtotal');
        if (!subtotalResult.ok) return badRequest(reply, subtotalResult.message);
        subtotalValue = subtotalResult.value;
      }

      let taxAmountValue = taxAmount;
      if (taxAmount !== undefined) {
        const taxAmountResult = optionalLocalizedNonNegativeNumber(taxAmount, 'taxAmount');
        if (!taxAmountResult.ok) return badRequest(reply, taxAmountResult.message);
        taxAmountValue = taxAmountResult.value;
      }

      let totalValue = total;
      if (total !== undefined) {
        const totalResult = optionalLocalizedNonNegativeNumber(total, 'total');
        if (!totalResult.ok) return badRequest(reply, totalResult.message);
        totalValue = totalResult.value;
      }

      let amountPaidValue = amountPaid;
      if (amountPaid !== undefined) {
        const amountPaidResult = optionalLocalizedNonNegativeNumber(amountPaid, 'amountPaid');
        if (!amountPaidResult.ok) return badRequest(reply, amountPaidResult.message);
        amountPaidValue = amountPaidResult.value;
      }

      try {
        const invoiceResult = await query(
          `UPDATE supplier_invoices
           SET id = COALESCE($1, id),
               supplier_id = COALESCE($2, supplier_id),
               supplier_name = COALESCE($3, supplier_name),
               issue_date = COALESCE($4, issue_date),
               due_date = COALESCE($5, due_date),
               status = COALESCE($6, status),
               subtotal = COALESCE($7, subtotal),
               tax_amount = COALESCE($8, tax_amount),
               total = COALESCE($9, total),
               amount_paid = COALESCE($10, amount_paid),
               notes = COALESCE($11, notes),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $12
           RETURNING
              id,
              linked_sale_id as "linkedSaleId",
              supplier_id as "supplierId",
              supplier_name as "supplierName",
              issue_date as "issueDate",
              due_date as "dueDate",
              status,
              subtotal,
              tax_amount as "taxAmount",
              total,
              amount_paid as "amountPaid",
              notes,
              EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
              EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
          [
            nextIdValue,
            supplierIdValue,
            supplierNameValue,
            issueDateValue,
            dueDateValue,
            status,
            subtotalValue,
            taxAmountValue,
            totalValue,
            amountPaidValue,
            notes,
            idResult.value,
          ],
        );

        const updatedInvoiceId = String(invoiceResult.rows[0].id);

        let updatedItems: Array<Record<string, unknown>> = [];
        if (items !== undefined) {
          if (!Array.isArray(items) || items.length === 0) {
            return badRequest(reply, 'Items must be a non-empty array');
          }
          const normalizedItems = normalizeItems(items, reply);
          if (!normalizedItems) return;

          await query('DELETE FROM supplier_invoice_items WHERE invoice_id = $1', [
            updatedInvoiceId,
          ]);

          for (const item of normalizedItems) {
            const itemId = `sinv-item-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
            const itemResult = await query(
              `INSERT INTO supplier_invoice_items
                (id, invoice_id, product_id, description, quantity, unit_price, tax_rate, discount)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               RETURNING
                  id,
                  invoice_id as "invoiceId",
                  product_id as "productId",
                  description,
                  quantity,
                  unit_price as "unitPrice",
                  tax_rate as "taxRate",
                  discount`,
              [
                itemId,
                updatedInvoiceId,
                item.productId || null,
                item.description,
                item.quantity,
                item.unitPrice,
                item.taxRate,
                item.discount || 0,
              ],
            );
            updatedItems.push(itemResult.rows[0]);
          }
        } else {
          const itemsResult = await query(
            `SELECT
                id,
                invoice_id as "invoiceId",
                product_id as "productId",
                description,
                quantity,
                unit_price as "unitPrice",
                tax_rate as "taxRate",
                discount
             FROM supplier_invoice_items
             WHERE invoice_id = $1`,
            [updatedInvoiceId],
          );
          updatedItems = itemsResult.rows;
        }

        const changedFields = Object.entries({
          id: nextId !== undefined,
          supplierId: supplierId !== undefined,
          supplierName: supplierName !== undefined,
          issueDate: issueDate !== undefined,
          dueDate: dueDate !== undefined,
          status: status !== undefined,
          subtotal: subtotal !== undefined,
          taxAmount: taxAmount !== undefined,
          total: total !== undefined,
          amountPaid: amountPaid !== undefined,
          notes: notes !== undefined,
          items: items !== undefined,
        }).flatMap(([field, changed]) => (changed ? [field] : []));
        const nextStatus =
          typeof status === 'string'
            ? status
            : String(invoiceResult.rows[0].status ?? existingInvoice.status);
        const didStatusChange = status !== undefined && existingInvoice.status !== nextStatus;
        await logAudit({
          request,
          action: 'supplier_invoice.updated',
          entityType: 'supplier_invoice',
          entityId: updatedInvoiceId,
          details: {
            targetLabel: updatedInvoiceId,
            secondaryLabel: String(invoiceResult.rows[0].supplierName ?? ''),
            changedFields,
            fromValue: didStatusChange ? String(existingInvoice.status) : undefined,
            toValue: didStatusChange ? nextStatus : undefined,
          },
        });
        return formatInvoiceResponse(invoiceResult.rows[0], updatedItems);
      } catch (error) {
        const databaseError = error as DatabaseError;
        if (databaseError.code === '23505') {
          return reply.code(409).send({ error: duplicateInvoiceError(databaseError) });
        }
        throw error;
      }
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

      const invoiceResult = await query(
        'SELECT id, status, supplier_name as "supplierName" FROM supplier_invoices WHERE id = $1',
        [idResult.value],
      );
      if (invoiceResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Invoice not found' });
      }
      if (invoiceResult.rows[0].status !== 'draft') {
        return reply.code(409).send({ error: 'Only draft invoices can be deleted' });
      }

      await query('DELETE FROM supplier_invoices WHERE id = $1', [idResult.value]);

      await logAudit({
        request,
        action: 'supplier_invoice.deleted',
        entityType: 'supplier_invoice',
        entityId: idResult.value,
        details: {
          targetLabel: idResult.value,
          secondaryLabel: String(invoiceResult.rows[0].supplierName ?? ''),
        },
      });
      return reply.code(204).send();
    },
  );
}
