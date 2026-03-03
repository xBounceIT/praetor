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

const duplicateInvoiceError = (databaseError: DatabaseError) => {
  if (databaseError.constraint === 'idx_supplier_invoices_linked_sale_id_unique') {
    return 'An invoice already exists for this order';
  }
  if (databaseError.constraint === 'supplier_invoices_invoice_number_key') {
    return 'Invoice number already exists';
  }
  if (databaseError.detail?.includes('(linked_sale_id)')) {
    return 'An invoice already exists for this order';
  }
  if (databaseError.detail?.includes('(invoice_number)')) {
    return 'Invoice number already exists';
  }
  return 'Invoice number already exists';
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
    invoiceNumber: { type: 'string' },
    issueDate: { type: 'string', format: 'date' },
    dueDate: { type: 'string', format: 'date' },
    status: { type: 'string' },
    subtotal: { type: 'number' },
    taxAmount: { type: 'number' },
    total: { type: 'number' },
    amountPaid: { type: 'number' },
    notes: { type: ['string', 'null'] },
    linkedExpenseId: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    items: { type: 'array', items: invoiceItemSchema },
  },
  required: [
    'id',
    'supplierId',
    'supplierName',
    'invoiceNumber',
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
    linkedSaleId: { type: 'string' },
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    invoiceNumber: { type: 'string' },
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
  required: ['supplierId', 'supplierName', 'invoiceNumber', 'issueDate', 'dueDate', 'items'],
} as const;

const updateBodySchema = {
  type: 'object',
  properties: {
    supplierId: { type: 'string' },
    supplierName: { type: 'string' },
    invoiceNumber: { type: 'string' },
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

const syncExpenseForInvoice = async (invoice: {
  id: string;
  supplierName: string;
  invoiceNumber: string;
  issueDate: string | Date;
  total: string | number;
  notes?: string | null;
}) => {
  const expenseDate =
    invoice.issueDate instanceof Date
      ? invoice.issueDate.toISOString().split('T')[0]
      : String(invoice.issueDate).split('T')[0];
  const description = `Supplier invoice ${invoice.invoiceNumber}`;

  const existingExpenseResult = await query(
    'SELECT id FROM expenses WHERE supplier_invoice_id = $1 LIMIT 1',
    [invoice.id],
  );

  if (existingExpenseResult.rows.length > 0) {
    const expenseResult = await query(
      `UPDATE expenses
       SET description = $1,
           amount = $2,
           expense_date = $3,
           category = $4,
           vendor = $5,
           receipt_reference = $6,
           notes = $7,
           source_type = 'supplier_invoice'
       WHERE supplier_invoice_id = $8
       RETURNING id`,
      [
        description,
        Number(invoice.total ?? 0),
        expenseDate,
        'other',
        invoice.supplierName,
        invoice.invoiceNumber,
        invoice.notes ?? null,
        invoice.id,
      ],
    );
    return expenseResult.rows[0]?.id ?? null;
  }

  const expenseId = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const expenseResult = await query(
    `INSERT INTO expenses
      (id, description, amount, expense_date, category, vendor, receipt_reference, notes, source_type, supplier_invoice_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'supplier_invoice', $9)
     RETURNING id`,
    [
      expenseId,
      description,
      Number(invoice.total ?? 0),
      expenseDate,
      'other',
      invoice.supplierName,
      invoice.invoiceNumber,
      invoice.notes ?? null,
      invoice.id,
    ],
  );
  return expenseResult.rows[0]?.id ?? null;
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
  issueDate:
    invoice.issueDate instanceof Date
      ? invoice.issueDate.toISOString().split('T')[0]
      : String(invoice.issueDate).split('T')[0],
  dueDate:
    invoice.dueDate instanceof Date
      ? invoice.dueDate.toISOString().split('T')[0]
      : String(invoice.dueDate).split('T')[0],
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
      onRequest: [requirePermission('accounting.supplier_invoices.view')],
      schema: {
        tags: ['supplier-invoices'],
        summary: 'List supplier invoices',
        response: {
          200: { type: 'array', items: invoiceSchema },
          ...standardErrorResponses,
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
            si.invoice_number as "invoiceNumber",
            si.issue_date as "issueDate",
            si.due_date as "dueDate",
            si.status,
            si.subtotal,
            si.tax_amount as "taxAmount",
            si.total,
            si.amount_paid as "amountPaid",
            si.notes,
            (
              SELECT e.id
              FROM expenses e
              WHERE e.supplier_invoice_id = si.id
              LIMIT 1
            ) as "linkedExpenseId",
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
        linkedSaleId,
        supplierId,
        supplierName,
        invoiceNumber,
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
        linkedSaleId?: unknown;
        supplierId: unknown;
        supplierName: unknown;
        invoiceNumber: unknown;
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

      const invoiceNumberResult = requireNonEmptyString(invoiceNumber, 'invoiceNumber');
      if (!invoiceNumberResult.ok) return badRequest(reply, invoiceNumberResult.message);

      const issueDateResult = parseDateString(issueDate, 'issueDate');
      if (!issueDateResult.ok) return badRequest(reply, issueDateResult.message);

      const dueDateResult = parseDateString(dueDate, 'dueDate');
      if (!dueDateResult.ok) return badRequest(reply, dueDateResult.message);

      if (new Date(dueDateResult.value) < new Date(issueDateResult.value)) {
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

      const invoiceId = `sinv-${Date.now()}`;

      try {
        const invoiceResult = await query(
          `INSERT INTO supplier_invoices
            (id, linked_sale_id, supplier_id, supplier_name, invoice_number, issue_date, due_date, status, subtotal, tax_amount, total, amount_paid, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING
              id,
              linked_sale_id as "linkedSaleId",
              supplier_id as "supplierId",
              supplier_name as "supplierName",
              invoice_number as "invoiceNumber",
              issue_date as "issueDate",
              due_date as "dueDate",
              status,
              subtotal,
              tax_amount as "taxAmount",
              total,
              amount_paid as "amountPaid",
              notes,
              null::varchar as "linkedExpenseId",
              EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
              EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
          [
            invoiceId,
            linkedSaleIdResult.value || null,
            supplierIdResult.value,
            supplierNameResult.value,
            invoiceNumberResult.value,
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
              invoiceId,
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

        const linkedExpenseId = await syncExpenseForInvoice({
          id: invoiceId,
          supplierName: supplierNameResult.value,
          invoiceNumber: invoiceNumberResult.value,
          issueDate: issueDateResult.value,
          total: totalResult.value || 0,
          notes: (notes as string | undefined) || null,
        });

        return reply
          .code(201)
          .send(formatInvoiceResponse({ ...invoiceResult.rows[0], linkedExpenseId }, createdItems));
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
        supplierId,
        supplierName,
        invoiceNumber,
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
        supplierId: unknown;
        supplierName: unknown;
        invoiceNumber: unknown;
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

      let invoiceNumberValue = invoiceNumber;
      if (invoiceNumber !== undefined) {
        const invoiceNumberResult = optionalNonEmptyString(invoiceNumber, 'invoiceNumber');
        if (!invoiceNumberResult.ok) return badRequest(reply, invoiceNumberResult.message);
        invoiceNumberValue = invoiceNumberResult.value;
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
            issue_date as "issueDate",
            due_date as "dueDate"
         FROM supplier_invoices
         WHERE id = $1`,
        [idResult.value],
      );
      if (existingInvoiceResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Invoice not found' });
      }

      const effectiveIssueDate = issueDateValue ?? existingInvoiceResult.rows[0].issueDate;
      const effectiveDueDate = dueDateValue ?? existingInvoiceResult.rows[0].dueDate;

      if (new Date(String(effectiveDueDate)) < new Date(String(effectiveIssueDate))) {
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
           SET supplier_id = COALESCE($1, supplier_id),
               supplier_name = COALESCE($2, supplier_name),
               invoice_number = COALESCE($3, invoice_number),
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
              invoice_number as "invoiceNumber",
              issue_date as "issueDate",
              due_date as "dueDate",
              status,
              subtotal,
              tax_amount as "taxAmount",
              total,
              amount_paid as "amountPaid",
              notes,
              (
                SELECT e.id
                FROM expenses e
                WHERE e.supplier_invoice_id = supplier_invoices.id
                LIMIT 1
              ) as "linkedExpenseId",
              EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
              EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
          [
            supplierIdValue,
            supplierNameValue,
            invoiceNumberValue,
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

        let updatedItems: Array<Record<string, unknown>> = [];
        if (items !== undefined) {
          if (!Array.isArray(items) || items.length === 0) {
            return badRequest(reply, 'Items must be a non-empty array');
          }
          const normalizedItems = normalizeItems(items, reply);
          if (!normalizedItems) return;

          await query('DELETE FROM supplier_invoice_items WHERE invoice_id = $1', [idResult.value]);

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
                idResult.value,
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
            [idResult.value],
          );
          updatedItems = itemsResult.rows;
        }

        const invoice = invoiceResult.rows[0];
        const linkedExpenseId = await syncExpenseForInvoice({
          id: idResult.value,
          supplierName: String(invoice.supplierName),
          invoiceNumber: String(invoice.invoiceNumber),
          issueDate: invoice.issueDate as string | Date,
          total: invoice.total as string | number,
          notes: (invoice.notes as string | null | undefined) ?? null,
        });

        return formatInvoiceResponse({ ...invoice, linkedExpenseId }, updatedItems);
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

      const invoiceResult = await query('SELECT id FROM supplier_invoices WHERE id = $1', [
        idResult.value,
      ]);
      if (invoiceResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Invoice not found' });
      }

      await query('DELETE FROM expenses WHERE supplier_invoice_id = $1', [idResult.value]);
      await query('DELETE FROM supplier_invoices WHERE id = $1', [idResult.value]);

      return reply.code(204).send();
    },
  );
}
