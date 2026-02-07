import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import {
  requireNonEmptyString,
  optionalNonEmptyString,
  parseDateString,
  optionalDateString,
  parseLocalizedPositiveNumber,
  parseLocalizedNonNegativeNumber,
  optionalLocalizedNonNegativeNumber,
  badRequest,
} from '../utils/validation.ts';
import { standardErrorResponses } from '../schemas/common.ts';

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
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    invoiceNumber: { type: 'string' },
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
    'clientId',
    'clientName',
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

const invoiceCreateBodySchema = {
  type: 'object',
  properties: {
    linkedSaleId: { type: 'string' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
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
  required: ['clientId', 'clientName', 'invoiceNumber', 'issueDate', 'dueDate', 'items'],
} as const;

const invoiceUpdateBodySchema = {
  type: 'object',
  properties: {
    clientId: { type: 'string' },
    clientName: { type: 'string' },
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

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // All invoices routes require authentication
  fastify.addHook('onRequest', authenticateToken);

  // GET / - List all invoices with their items
  fastify.get(
    '/',
    {
      onRequest: [requirePermission('accounting.clients_invoices.view')],
      schema: {
        tags: ['invoices'],
        summary: 'List invoices',
        response: {
          200: { type: 'array', items: invoiceSchema },
          ...standardErrorResponses,
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      // Get all invoices
      const invoicesResult = await query(
        `SELECT 
                id, 
                linked_sale_id as "linkedSaleId",
                client_id as "clientId", 
                client_name as "clientName", 
                invoice_number as "invoiceNumber", 
                issue_date as "issueDate",
                due_date as "dueDate",
                status, 
                subtotal,
                tax_amount as "taxAmount",
                total,
                amount_paid as "amountPaid",
                notes,
                EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
                EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"
            FROM invoices 
            ORDER BY created_at DESC`,
      );

      // Get all invoice items
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
            FROM invoice_items
            ORDER BY created_at ASC`,
      );

      // Group items by invoice
      const itemsByInvoice: Record<string, unknown[]> = {};
      itemsResult.rows.forEach((item: { invoiceId: string }) => {
        if (!itemsByInvoice[item.invoiceId]) {
          itemsByInvoice[item.invoiceId] = [];
        }
        itemsByInvoice[item.invoiceId].push(item);
      });

      // Attach items to invoices
      const invoices = invoicesResult.rows.map(
        (invoice: {
          id: string;
          issueDate: { toISOString: () => string };
          dueDate: { toISOString: () => string };
          subtotal: string;
          taxAmount: string;
          total: string;
          amountPaid: string;
        }) => ({
          ...invoice,
          issueDate: invoice.issueDate.toISOString().split('T')[0],
          dueDate: invoice.dueDate.toISOString().split('T')[0],
          subtotal: parseFloat(invoice.subtotal),
          taxAmount: parseFloat(invoice.taxAmount),
          total: parseFloat(invoice.total),
          amountPaid: parseFloat(invoice.amountPaid),
          items: (itemsByInvoice[invoice.id] || []).map((item: unknown) => {
            const typedItem = item as {
              quantity: string;
              unitPrice: string;
              taxRate: string;
              discount: string;
            };
            return {
              ...typedItem,
              quantity: parseFloat(typedItem.quantity),
              unitPrice: parseFloat(typedItem.unitPrice),
              taxRate: parseFloat(typedItem.taxRate),
              discount: parseFloat(typedItem.discount),
            };
          }),
        }),
      );

      return invoices;
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
        linkedSaleId,
        clientId,
        clientName,
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
        linkedSaleId: unknown;
        clientId: unknown;
        clientName: unknown;
        invoiceNumber: unknown;
        issueDate: unknown;
        dueDate: unknown;
        status: unknown;
        subtotal: unknown;
        taxAmount: unknown;
        total: unknown;
        amountPaid: unknown;
        notes: unknown;
        items: unknown;
      };

      const clientIdResult = requireNonEmptyString(clientId, 'clientId');
      if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);

      const clientNameResult = requireNonEmptyString(clientName, 'clientName');
      if (!clientNameResult.ok) return badRequest(reply, clientNameResult.message);

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

      const normalizedItems = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const descriptionResult = requireNonEmptyString(
          item.description,
          `items[${i}].description`,
        );
        if (!descriptionResult.ok) return badRequest(reply, descriptionResult.message);
        const quantityResult = parseLocalizedPositiveNumber(item.quantity, `items[${i}].quantity`);
        if (!quantityResult.ok) return badRequest(reply, quantityResult.message);
        const unitPriceResult = parseLocalizedNonNegativeNumber(
          item.unitPrice,
          `items[${i}].unitPrice`,
        );
        if (!unitPriceResult.ok) return badRequest(reply, unitPriceResult.message);
        const taxRateResult = parseLocalizedNonNegativeNumber(item.taxRate, `items[${i}].taxRate`);
        if (!taxRateResult.ok) return badRequest(reply, taxRateResult.message);
        const discountResult = optionalLocalizedNonNegativeNumber(
          item.discount,
          `items[${i}].discount`,
        );
        if (!discountResult.ok) return badRequest(reply, discountResult.message);
        normalizedItems.push({
          ...item,
          description: descriptionResult.value,
          quantity: quantityResult.value,
          unitPrice: unitPriceResult.value,
          taxRate: taxRateResult.value,
          discount: discountResult.value || 0,
        });
      }

      const subtotalResult = optionalLocalizedNonNegativeNumber(subtotal, 'subtotal');
      if (!subtotalResult.ok) return badRequest(reply, subtotalResult.message);

      const taxAmountResult = optionalLocalizedNonNegativeNumber(taxAmount, 'taxAmount');
      if (!taxAmountResult.ok) return badRequest(reply, taxAmountResult.message);

      const totalResult = optionalLocalizedNonNegativeNumber(total, 'total');
      if (!totalResult.ok) return badRequest(reply, totalResult.message);

      const amountPaidResult = optionalLocalizedNonNegativeNumber(amountPaid, 'amountPaid');
      if (!amountPaidResult.ok) return badRequest(reply, amountPaidResult.message);

      const invoiceId = 'inv-' + Date.now();

      // Insert invoice
      const invoiceResult = await query(
        `INSERT INTO invoices (
                    id, linked_sale_id, client_id, client_name, invoice_number, issue_date, due_date, 
                    status, subtotal, tax_amount, total, amount_paid, notes
                ) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
                RETURNING 
                    id, 
                    linked_sale_id as "linkedSaleId",
                    client_id as "clientId", 
                    client_name as "clientName", 
                    invoice_number as "invoiceNumber", 
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
          invoiceId,
          linkedSaleId || null,
          clientIdResult.value,
          clientNameResult.value,
          invoiceNumberResult.value,
          issueDateResult.value,
          dueDateResult.value,
          status || 'draft',
          subtotalResult.value || 0,
          taxAmountResult.value || 0,
          totalResult.value || 0,
          amountPaidResult.value || 0,
          notes,
        ],
      );

      // Insert invoice items
      const createdItems = [];
      for (const item of normalizedItems) {
        const itemId = 'inv-item-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        const itemResult = await query(
          `INSERT INTO invoice_items (
                        id, invoice_id, product_id, description, quantity, unit_price, tax_rate, discount
                    ) 
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

      const invoice = invoiceResult.rows[0];
      return reply.code(201).send({
        ...invoice,
        issueDate: new Date(invoice.issueDate).toISOString().split('T')[0],
        dueDate: new Date(invoice.dueDate).toISOString().split('T')[0],
        subtotal: parseFloat(invoice.subtotal),
        taxAmount: parseFloat(invoice.taxAmount),
        total: parseFloat(invoice.total),
        amountPaid: parseFloat(invoice.amountPaid),
        items: createdItems.map((item) => ({
          ...item,
          quantity: parseFloat(item.quantity),
          unitPrice: parseFloat(item.unitPrice),
          taxRate: parseFloat(item.taxRate),
          discount: parseFloat(item.discount),
        })),
      });
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
        clientId,
        clientName,
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
        clientId: unknown;
        clientName: unknown;
        invoiceNumber: unknown;
        issueDate: unknown;
        dueDate: unknown;
        status: unknown;
        subtotal: unknown;
        taxAmount: unknown;
        total: unknown;
        amountPaid: unknown;
        notes: unknown;
        items: unknown;
      };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      let clientIdValue = clientId;
      if (clientId !== undefined) {
        const clientIdResult = optionalNonEmptyString(clientId, 'clientId');
        if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);
        clientIdValue = clientIdResult.value;
      }

      let clientNameValue = clientName;
      if (clientName !== undefined) {
        const clientNameResult = optionalNonEmptyString(clientName, 'clientName');
        if (!clientNameResult.ok) return badRequest(reply, clientNameResult.message);
        clientNameValue = clientNameResult.value;
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

      if (issueDate && dueDate) {
        if (new Date(dueDate as string) < new Date(issueDate as string)) {
          return badRequest(reply, 'dueDate must be on or after issueDate');
        }
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

      // Update invoice
      const invoiceResult = await query(
        `UPDATE invoices 
                SET client_id = COALESCE($1, client_id),
                    client_name = COALESCE($2, client_name),
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
                    client_id as "clientId", 
                    client_name as "clientName", 
                    invoice_number as "invoiceNumber", 
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
          clientIdValue,
          clientNameValue,
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

      if (invoiceResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Invoice not found' });
      }

      // If items are provided, update them
      let updatedItems = [];
      if (items) {
        if (!Array.isArray(items) || items.length === 0) {
          return badRequest(reply, 'Items must be a non-empty array');
        }
        const normalizedItems = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const descriptionResult = requireNonEmptyString(
            item.description,
            `items[${i}].description`,
          );
          if (!descriptionResult.ok) return badRequest(reply, descriptionResult.message);
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
          const taxRateResult = parseLocalizedNonNegativeNumber(
            item.taxRate,
            `items[${i}].taxRate`,
          );
          if (!taxRateResult.ok) return badRequest(reply, taxRateResult.message);
          const discountResult = optionalLocalizedNonNegativeNumber(
            item.discount,
            `items[${i}].discount`,
          );
          if (!discountResult.ok) return badRequest(reply, discountResult.message);
          normalizedItems.push({
            ...item,
            description: descriptionResult.value,
            quantity: quantityResult.value,
            unitPrice: unitPriceResult.value,
            taxRate: taxRateResult.value,
            discount: discountResult.value || 0,
          });
        }
        // Delete existing items
        await query('DELETE FROM invoice_items WHERE invoice_id = $1', [idResult.value]);

        // Insert new items
        for (const item of normalizedItems) {
          const itemId = 'inv-item-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
          const itemResult = await query(
            `INSERT INTO invoice_items (
                            id, invoice_id, product_id, description, quantity, unit_price, tax_rate, discount
                        ) 
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
        // Fetch existing items
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
                    FROM invoice_items
                    WHERE invoice_id = $1`,
          [idResult.value],
        );
        updatedItems = itemsResult.rows;
      }

      const invoice = invoiceResult.rows[0];
      return {
        ...invoice,
        issueDate: new Date(invoice.issueDate).toISOString().split('T')[0],
        dueDate: new Date(invoice.dueDate).toISOString().split('T')[0],
        subtotal: parseFloat(invoice.subtotal),
        taxAmount: parseFloat(invoice.taxAmount),
        total: parseFloat(invoice.total),
        amountPaid: parseFloat(invoice.amountPaid),
        items: updatedItems.map((item) => ({
          ...item,
          quantity: parseFloat(item.quantity),
          unitPrice: parseFloat(item.unitPrice),
          taxRate: parseFloat(item.taxRate),
          discount: parseFloat(item.discount),
        })),
      };
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

      // Items and payments will be deleted automatically via CASCADE
      try {
        const result = await query('DELETE FROM invoices WHERE id = $1 RETURNING id', [
          idResult.value,
        ]);

        if (result.rows.length === 0) {
          return reply.code(404).send({ error: 'Invoice not found' });
        }

        return reply.code(204).send();
      } catch (err) {
        console.error('DELETE INVOICE ERROR:', err);
        const error = err as DatabaseError;
        // Check for specific DB errors
        if (error.code === '23503') {
          // Foreign key violation
          return reply.code(409).send({
            error:
              'Cannot delete invoice because it is referenced by other records (e.g. payments)',
          });
        }
        throw err;
      }
    },
  );
}
