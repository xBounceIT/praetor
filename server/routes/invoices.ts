import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
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
  validateEnum,
} from '../utils/validation.ts';

interface DatabaseError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
}

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
    specialBidId: { type: ['string', 'null'] },
    description: { type: 'string' },
    unitOfMeasure: { type: 'string', enum: [...UNIT_OF_MEASURE_VALUES] },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    taxRate: { type: 'number' },
    discount: { type: 'number' },
  },
  required: [
    'id',
    'invoiceId',
    'description',
    'unitOfMeasure',
    'quantity',
    'unitPrice',
    'taxRate',
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
    specialBidId: { type: ['string', 'null'] },
    description: { type: 'string' },
    unitOfMeasure: { type: 'string', enum: [...UNIT_OF_MEASURE_VALUES] },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    taxRate: { type: 'number' },
    discount: { type: 'number' },
  },
  required: ['description', 'unitOfMeasure', 'quantity', 'unitPrice', 'taxRate'],
} as const;

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
    subtotal: { type: 'number' },
    taxAmount: { type: 'number' },
    total: { type: 'number' },
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
    subtotal: { type: 'number' },
    taxAmount: { type: 'number' },
    total: { type: 'number' },
    amountPaid: { type: 'number' },
    notes: { type: 'string' },
    items: { type: 'array', items: invoiceItemBodySchema },
  },
} as const;

const toRequiredDateOnly = (value: unknown, fieldName: string) => {
  const normalizedDate = normalizeNullableDateOnly(value, fieldName);
  if (!normalizedDate) {
    throw new TypeError(`Invalid date value for ${fieldName}`);
  }
  return normalizedDate;
};

const generateInvoiceId = async (issueDate: string) => {
  const year = issueDate.split('-')[0];
  const result = await query(
    `SELECT COALESCE(MAX(CAST(split_part(id, '-', 3) AS INTEGER)), 0) as "maxSequence"
     FROM invoices
     WHERE id ~ $1`,
    [`^INV-${year}-[0-9]+$`],
  );
  const nextSequence = Number(result.rows[0]?.maxSequence ?? 0) + 1;
  return `INV-${year}-${String(nextSequence).padStart(4, '0')}`;
};

const formatInvoiceItem = (item: Record<string, unknown>) => ({
  ...item,
  specialBidId:
    item.specialBidId === undefined || item.specialBidId === null
      ? null
      : String(item.specialBidId),
  unitOfMeasure: item.unitOfMeasure === 'hours' ? 'hours' : 'unit',
  quantity: parseFloat(String(item.quantity ?? 0)),
  unitPrice: parseFloat(String(item.unitPrice ?? 0)),
  taxRate: parseFloat(String(item.taxRate ?? 0)),
  discount: parseFloat(String(item.discount ?? 0)),
});

const getInvoiceClientId = async (invoiceId: string) => {
  const result = await query(`SELECT client_id as "clientId" FROM invoices WHERE id = $1`, [
    invoiceId,
  ]);
  return (result.rows[0]?.clientId as string | undefined) ?? null;
};

const validateAndNormalizeItems = async (
  items: unknown[],
  reply: FastifyReply,
  effectiveClientId: string,
) => {
  const normalizedItems = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i] as Record<string, unknown>;
    const productIdResult = optionalNonEmptyString(item.productId, `items[${i}].productId`);
    if (!productIdResult.ok) {
      badRequest(reply, productIdResult.message);
      return null;
    }

    const specialBidIdResult = optionalNonEmptyString(
      item.specialBidId,
      `items[${i}].specialBidId`,
    );
    if (!specialBidIdResult.ok) {
      badRequest(reply, specialBidIdResult.message);
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

    if (specialBidIdResult.value && !productIdResult.value) {
      badRequest(reply, `items[${i}].productId is required when specialBidId is provided`);
      return null;
    }

    if (specialBidIdResult.value) {
      const bidResult = await query(
        `SELECT product_id as "productId", client_id as "clientId"
         FROM special_bids
         WHERE id = $1`,
        [specialBidIdResult.value],
      );

      if (bidResult.rows.length === 0) {
        badRequest(reply, `items[${i}].specialBidId is invalid`);
        return null;
      }

      const bid = bidResult.rows[0] as { productId: string; clientId: string };
      if (bid.productId !== productIdResult.value) {
        badRequest(reply, `items[${i}].specialBidId does not match productId`);
        return null;
      }
      if (effectiveClientId && bid.clientId !== effectiveClientId) {
        badRequest(reply, `items[${i}].specialBidId does not match clientId`);
        return null;
      }
    }

    normalizedItems.push({
      ...item,
      productId: productIdResult.value,
      specialBidId: specialBidIdResult.value,
      description: descriptionResult.value,
      unitOfMeasure: unitOfMeasureResult.value,
      quantity: quantityResult.value,
      unitPrice: unitPriceResult.value,
      taxRate: taxRateResult.value,
      discount: discountResult.value || 0,
    });
  }

  return normalizedItems;
};

const formatInvoiceResponse = (
  invoice: Record<string, unknown>,
  items: Record<string, unknown>[],
) => ({
  ...invoice,
  issueDate: toRequiredDateOnly(invoice.issueDate, 'invoice.issueDate'),
  dueDate: toRequiredDateOnly(invoice.dueDate, 'invoice.dueDate'),
  subtotal: parseFloat(String(invoice.subtotal ?? 0)),
  taxAmount: parseFloat(String(invoice.taxAmount ?? 0)),
  total: parseFloat(String(invoice.total ?? 0)),
  amountPaid: parseFloat(String(invoice.amountPaid ?? 0)),
  items: items.map(formatInvoiceItem),
});

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
      // Get all invoices
      const invoicesResult = await query(
        `SELECT 
                id, 
                linked_sale_id as "linkedSaleId",
                client_id as "clientId", 
                client_name as "clientName", 
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
                special_bid_id as "specialBidId",
                description,
                unit_of_measure as "unitOfMeasure",
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
      const invoices = invoicesResult.rows.map((invoice) =>
        formatInvoiceResponse(
          invoice as Record<string, unknown>,
          (itemsByInvoice[invoice.id] || []) as Record<string, unknown>[],
        ),
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
        id: nextId,
        linkedSaleId,
        clientId,
        clientName,
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
        linkedSaleId: unknown;
        clientId: unknown;
        clientName: unknown;
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
      const normalizedItems = await validateAndNormalizeItems(items, reply, clientIdResult.value);
      if (!normalizedItems) return;

      const subtotalResult = optionalLocalizedNonNegativeNumber(subtotal, 'subtotal');
      if (!subtotalResult.ok) return badRequest(reply, subtotalResult.message);

      const taxAmountResult = optionalLocalizedNonNegativeNumber(taxAmount, 'taxAmount');
      if (!taxAmountResult.ok) return badRequest(reply, taxAmountResult.message);

      const totalResult = optionalLocalizedNonNegativeNumber(total, 'total');
      if (!totalResult.ok) return badRequest(reply, totalResult.message);

      const amountPaidResult = optionalLocalizedNonNegativeNumber(amountPaid, 'amountPaid');
      if (!amountPaidResult.ok) return badRequest(reply, amountPaidResult.message);

      const nextIdResult = optionalNonEmptyString(nextId, 'id');
      if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);
      const invoiceId = nextIdResult.value || (await generateInvoiceId(issueDateResult.value));

      let invoiceResult: Awaited<ReturnType<typeof query>>;
      try {
        invoiceResult = await query(
          `INSERT INTO invoices (
                      id, linked_sale_id, client_id, client_name, issue_date, due_date, 
                      status, subtotal, tax_amount, total, amount_paid, notes
                  ) 
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
                  RETURNING 
                      id, 
                      linked_sale_id as "linkedSaleId",
                      client_id as "clientId", 
                      client_name as "clientName", 
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
      } catch (error) {
        const databaseError = error as DatabaseError;
        if (
          databaseError.code === '23505' &&
          (databaseError.constraint === 'invoices_pkey' || databaseError.detail?.includes('(id)'))
        ) {
          return reply.code(409).send({ error: 'Invoice ID already exists' });
        }
        throw error;
      }

      // Insert invoice items
      const createdItems = [];
      for (const item of normalizedItems) {
        const itemId = 'inv-item-' + Date.now() + '-' + Math.random().toString(36).substring(2, 11);
        const itemResult = await query(
          `INSERT INTO invoice_items (
                        id, invoice_id, product_id, special_bid_id, description, unit_of_measure, quantity, unit_price, tax_rate, discount
                    ) 
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
                    RETURNING 
                        id,
                        invoice_id as "invoiceId",
                        product_id as "productId",
                        special_bid_id as "specialBidId",
                        description,
                        unit_of_measure as "unitOfMeasure",
                        quantity,
                        unit_price as "unitPrice",
                        tax_rate as "taxRate",
                        discount`,
          [
            itemId,
            invoiceId,
            item.productId || null,
            item.specialBidId || null,
            item.description,
            item.unitOfMeasure,
            item.quantity,
            item.unitPrice,
            item.taxRate,
            item.discount || 0,
          ],
        );
        createdItems.push(itemResult.rows[0]);
      }

      const invoice = invoiceResult.rows[0];
      return reply
        .code(201)
        .send(formatInvoiceResponse(invoice as Record<string, unknown>, createdItems));
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
        subtotal,
        taxAmount,
        total,
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
        subtotal: unknown;
        taxAmount: unknown;
        total: unknown;
        amountPaid: unknown;
        notes: unknown;
        items: unknown;
      };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const existingClientId = items ? await getInvoiceClientId(idResult.value) : null;
      if (items && !existingClientId) {
        return reply.code(404).send({ error: 'Invoice not found' });
      }

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

      let nextIdValue = nextId;
      if (nextId !== undefined) {
        const nextIdResult = optionalNonEmptyString(nextId, 'id');
        if (!nextIdResult.ok) return badRequest(reply, nextIdResult.message);
        nextIdValue = nextIdResult.value;
        if (nextIdResult.value) {
          const existingIdResult = await query(
            'SELECT id FROM invoices WHERE id = $1 AND id <> $2',
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

      if (issueDate && dueDate) {
        if ((dueDate as string) < (issueDate as string)) {
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
      let invoiceResult: Awaited<ReturnType<typeof query>>;
      try {
        invoiceResult = await query(
          `UPDATE invoices 
                  SET id = COALESCE($1, id),
                      client_id = COALESCE($2, client_id),
                      client_name = COALESCE($3, client_name),
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
            clientIdValue,
            clientNameValue,
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
      } catch (error) {
        const databaseError = error as DatabaseError;
        if (
          databaseError.code === '23505' &&
          (databaseError.constraint === 'invoices_pkey' || databaseError.detail?.includes('(id)'))
        ) {
          return reply.code(409).send({ error: 'Invoice ID already exists' });
        }
        throw error;
      }

      if (invoiceResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Invoice not found' });
      }

      const updatedInvoiceId = String(invoiceResult.rows[0].id);

      // If items are provided, update them
      let updatedItems = [];
      if (items) {
        if (!Array.isArray(items) || items.length === 0) {
          return badRequest(reply, 'Items must be a non-empty array');
        }
        const effectiveClientId =
          typeof clientIdValue === 'string' && clientIdValue.trim().length > 0
            ? clientIdValue
            : existingClientId || '';
        const normalizedItems = await validateAndNormalizeItems(items, reply, effectiveClientId);
        if (!normalizedItems) return;
        // Delete existing items
        await query('DELETE FROM invoice_items WHERE invoice_id = $1', [updatedInvoiceId]);

        // Insert new items
        for (const item of normalizedItems) {
          const itemId =
            'inv-item-' + Date.now() + '-' + Math.random().toString(36).substring(2, 11);
          const itemResult = await query(
            `INSERT INTO invoice_items (
                            id, invoice_id, product_id, special_bid_id, description, unit_of_measure, quantity, unit_price, tax_rate, discount
                        ) 
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
                        RETURNING 
                            id,
                            invoice_id as "invoiceId",
                            product_id as "productId",
                            special_bid_id as "specialBidId",
                            description,
                            unit_of_measure as "unitOfMeasure",
                            quantity,
                            unit_price as "unitPrice",
                            tax_rate as "taxRate",
                            discount`,
            [
              itemId,
              updatedInvoiceId,
              item.productId || null,
              item.specialBidId || null,
              item.description,
              item.unitOfMeasure,
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
                        special_bid_id as "specialBidId",
                        description,
                        unit_of_measure as "unitOfMeasure",
                        quantity,
                        unit_price as "unitPrice",
                        tax_rate as "taxRate",
                        discount
                    FROM invoice_items
                    WHERE invoice_id = $1`,
          [updatedInvoiceId],
        );
        updatedItems = itemsResult.rows;
      }

      const invoice = invoiceResult.rows[0];
      return formatInvoiceResponse(
        invoice as Record<string, unknown>,
        updatedItems as Record<string, unknown>[],
      );
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
            error: 'Cannot delete invoice because it is referenced by other records',
          });
        }
        throw err;
      }
    },
  );
}
