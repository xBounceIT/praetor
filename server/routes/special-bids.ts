import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import {
  badRequest,
  optionalDateString,
  optionalLocalizedNonNegativeNumber,
  optionalNonEmptyString,
  parseDateString,
  parseLocalizedPositiveNumber,
  requireNonEmptyString,
} from '../utils/validation.ts';

const MAX_BID_CODE_RETRIES = 5;

/**
 * Generate a unique bid code following the pattern BID-YYYY-NNNN
 * Example: BID-2025-0001, BID-2025-0002
 */
async function generateBidCode(): Promise<string> {
  const year = new Date().getFullYear();
  const result = await query(
    `SELECT COALESCE(MAX(CAST(split_part(bid_code, '-', 3) AS INTEGER)), 0) as "maxSequence"
     FROM special_bids
     WHERE bid_code ~ $1`,
    [`^BID-${year}-[0-9]+$`],
  );
  const nextSequence = Number(result.rows[0]?.maxSequence ?? 0) + 1;
  return `BID-${year}-${String(nextSequence).padStart(4, '0')}`;
}

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const specialBidSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    bidCode: { type: 'string' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    productId: { type: 'string' },
    productName: { type: 'string' },
    unitPrice: { type: 'number' },
    molPercentage: { type: 'number', nullable: true },
    startDate: { type: 'string', format: 'date' },
    endDate: { type: 'string', format: 'date' },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
  },
  required: [
    'id',
    'bidCode',
    'clientId',
    'clientName',
    'productId',
    'productName',
    'unitPrice',
    'startDate',
    'endDate',
    'createdAt',
    'updatedAt',
  ],
} as const;

const specialBidCreateBodySchema = {
  type: 'object',
  properties: {
    bidCode: { type: 'string' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    productId: { type: 'string' },
    productName: { type: 'string' },
    unitPrice: { type: 'number' },
    molPercentage: { type: 'number' },
    startDate: { type: 'string', format: 'date' },
    endDate: { type: 'string', format: 'date' },
  },
  required: [
    'clientId',
    'clientName',
    'productId',
    'productName',
    'unitPrice',
    'startDate',
    'endDate',
  ],
} as const;

const specialBidUpdateBodySchema = {
  type: 'object',
  properties: {
    bidCode: { type: 'string' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    productId: { type: 'string' },
    productName: { type: 'string' },
    unitPrice: { type: 'number' },
    molPercentage: { type: 'number' },
    startDate: { type: 'string', format: 'date' },
    endDate: { type: 'string', format: 'date' },
  },
} as const;

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.addHook('onRequest', authenticateToken);

  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('catalog.special_bids.view'),
      ],
      schema: {
        tags: ['special-bids'],
        summary: 'List special bids',
        response: {
          200: { type: 'array', items: specialBidSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async () => {
      const result = await query(
        `SELECT
                id,
                bid_code as "bidCode",
                client_id as "clientId",
                client_name as "clientName",
                product_id as "productId",
                product_name as "productName",
                unit_price as "unitPrice",
                mol_percentage as "molPercentage",
                start_date as "startDate",
                end_date as "endDate",
                EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
                EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"
            FROM special_bids
            ORDER BY created_at DESC`,
      );
      return result.rows;
    },
  );

  fastify.post(
    '/',
    {
      onRequest: [requirePermission('catalog.special_bids.create')],
      schema: {
        tags: ['special-bids'],
        summary: 'Create special bid',
        body: specialBidCreateBodySchema,
        response: {
          201: specialBidSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        bidCode,
        clientId,
        clientName,
        productId,
        productName,
        unitPrice,
        molPercentage,
        startDate,
        endDate,
      } = request.body as {
        bidCode: unknown;
        clientId: unknown;
        clientName: unknown;
        productId: unknown;
        productName: unknown;
        unitPrice: unknown;
        molPercentage: unknown;
        startDate: unknown;
        endDate: unknown;
      };

      const clientIdResult = requireNonEmptyString(clientId, 'clientId');
      if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);

      const clientNameResult = requireNonEmptyString(clientName, 'clientName');
      if (!clientNameResult.ok) return badRequest(reply, clientNameResult.message);

      const productIdResult = requireNonEmptyString(productId, 'productId');
      if (!productIdResult.ok) return badRequest(reply, productIdResult.message);

      const productNameResult = requireNonEmptyString(productName, 'productName');
      if (!productNameResult.ok) return badRequest(reply, productNameResult.message);

      const unitPriceResult = parseLocalizedPositiveNumber(unitPrice, 'unitPrice');
      if (!unitPriceResult.ok) return badRequest(reply, unitPriceResult.message);

      const molPercentageResult = optionalLocalizedNonNegativeNumber(
        molPercentage,
        'molPercentage',
      );
      if (!molPercentageResult.ok) return badRequest(reply, molPercentageResult.message);
      if (molPercentageResult.value !== null && molPercentageResult.value > 100) {
        return badRequest(reply, 'molPercentage must be between 0 and 100');
      }

      const productCostResult = await query('SELECT costo FROM products WHERE id = $1', [
        productIdResult.value,
      ]);
      if (productCostResult.rows.length === 0) {
        return badRequest(reply, 'productId is invalid');
      }
      const productCost = parseFloat(productCostResult.rows[0].costo);
      if (!Number.isFinite(productCost)) {
        return badRequest(reply, 'Product cost is invalid');
      }
      if (unitPriceResult.value >= productCost) {
        return badRequest(reply, 'unitPrice must be less than product cost');
      }

      const startDateResult = parseDateString(startDate, 'startDate');
      if (!startDateResult.ok) return badRequest(reply, startDateResult.message);

      const endDateResult = parseDateString(endDate, 'endDate');
      if (!endDateResult.ok) return badRequest(reply, endDateResult.message);

      if (new Date(endDateResult.value) < new Date(startDateResult.value)) {
        return badRequest(reply, 'endDate must be on or after startDate');
      }

      const existing = await query(
        `SELECT id FROM special_bids
             WHERE client_id = $1
               AND product_id = $2
               AND start_date <= CURRENT_DATE
               AND end_date >= CURRENT_DATE
               AND $3::date <= CURRENT_DATE
               AND $4::date >= CURRENT_DATE`,
        [clientIdResult.value, productIdResult.value, startDateResult.value, endDateResult.value],
      );
      if (existing.rows.length > 0) {
        return reply
          .code(409)
          .send({ error: 'An active special bid already exists for this client and product' });
      }

      // Validate or generate bid code
      let bidCodeValue = '';
      const isAutoGenerated = !(bidCode !== undefined && bidCode !== null && bidCode !== '');

      if (!isAutoGenerated) {
        const bidCodeResult = requireNonEmptyString(bidCode, 'bidCode');
        if (!bidCodeResult.ok) return badRequest(reply, bidCodeResult.message);
        bidCodeValue = bidCodeResult.value;

        // Check uniqueness
        const existingCodeResult = await query('SELECT id FROM special_bids WHERE bid_code = $1', [
          bidCodeValue,
        ]);
        if (existingCodeResult.rows.length > 0) {
          return badRequest(reply, 'bidCode must be unique');
        }
      }

      // Insert with retry loop for auto-generated bid codes to handle race conditions
      let lastError: Error | undefined;
      for (let attempt = 0; attempt < MAX_BID_CODE_RETRIES; attempt++) {
        if (isAutoGenerated) {
          bidCodeValue = await generateBidCode();
        }

        const id = 'sb-' + Date.now();

        try {
          const result = await query(
            `INSERT INTO special_bids (id, bid_code, client_id, client_name, product_id, product_name, unit_price, mol_percentage, start_date, end_date)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                 RETURNING
                    id,
                    bid_code as "bidCode",
                    client_id as "clientId",
                    client_name as "clientName",
                    product_id as "productId",
                    product_name as "productName",
                    unit_price as "unitPrice",
                    mol_percentage as "molPercentage",
                    start_date as "startDate",
                    end_date as "endDate",
                    EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
                    EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
            [
              id,
              bidCodeValue,
              clientIdResult.value,
              clientNameResult.value,
              productIdResult.value,
              productNameResult.value,
              unitPriceResult.value,
              molPercentageResult.value,
              startDateResult.value,
              endDateResult.value,
            ],
          );

          return reply.code(201).send(result.rows[0]);
        } catch (error) {
          // Check for unique constraint violation (PostgreSQL error code 23505)
          if (
            isAutoGenerated &&
            error instanceof Error &&
            'code' in error &&
            error.code === '23505'
          ) {
            lastError = error;
            continue;
          }
          throw error;
        }
      }

      throw (
        lastError ??
        new Error(`Failed to generate unique bid code after ${MAX_BID_CODE_RETRIES} attempts`)
      );
    },
  );

  fastify.put(
    '/:id',
    {
      onRequest: [requirePermission('catalog.special_bids.update')],
      schema: {
        tags: ['special-bids'],
        summary: 'Update special bid',
        params: idParamSchema,
        body: specialBidUpdateBodySchema,
        response: {
          200: specialBidSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const {
        bidCode,
        clientId,
        clientName,
        productId,
        productName,
        unitPrice,
        molPercentage,
        startDate,
        endDate,
      } = request.body as {
        bidCode: unknown;
        clientId: unknown;
        clientName: unknown;
        productId: unknown;
        productName: unknown;
        unitPrice: unknown;
        molPercentage: unknown;
        startDate: unknown;
        endDate: unknown;
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

      let productIdValue = productId;
      if (productId !== undefined) {
        const productIdResult = optionalNonEmptyString(productId, 'productId');
        if (!productIdResult.ok) return badRequest(reply, productIdResult.message);
        productIdValue = productIdResult.value;
      }

      let productNameValue = productName;
      if (productName !== undefined) {
        const productNameResult = optionalNonEmptyString(productName, 'productName');
        if (!productNameResult.ok) return badRequest(reply, productNameResult.message);
        productNameValue = productNameResult.value;
      }

      let unitPriceValue = unitPrice;
      if (unitPrice !== undefined) {
        const unitPriceResult = parseLocalizedPositiveNumber(unitPrice, 'unitPrice');
        if (!unitPriceResult.ok) return badRequest(reply, unitPriceResult.message);
        unitPriceValue = unitPriceResult.value;
      }

      let molPercentageValue = molPercentage;
      if (molPercentage !== undefined) {
        const molPercentageResult = optionalLocalizedNonNegativeNumber(
          molPercentage,
          'molPercentage',
        );
        if (!molPercentageResult.ok) return badRequest(reply, molPercentageResult.message);
        if (molPercentageResult.value !== null && molPercentageResult.value > 100) {
          return badRequest(reply, 'molPercentage must be between 0 and 100');
        }
        molPercentageValue = molPercentageResult.value;
      }

      let startDateValue = startDate;
      if (startDate !== undefined) {
        const startDateResult = optionalDateString(startDate, 'startDate');
        if (!startDateResult.ok) return badRequest(reply, startDateResult.message);
        startDateValue = startDateResult.value;
      }

      let endDateValue = endDate;
      if (endDate !== undefined) {
        const endDateResult = optionalDateString(endDate, 'endDate');
        if (!endDateResult.ok) return badRequest(reply, endDateResult.message);
        endDateValue = endDateResult.value;
      }

      let bidCodeValue = bidCode;
      if (bidCode !== undefined && bidCode !== null && bidCode !== '') {
        const bidCodeResult = requireNonEmptyString(bidCode, 'bidCode');
        if (!bidCodeResult.ok) return badRequest(reply, bidCodeResult.message);
        bidCodeValue = bidCodeResult.value;

        // Check uniqueness (excluding current bid)
        const existingCodeResult = await query(
          'SELECT id FROM special_bids WHERE bid_code = $1 AND id <> $2',
          [bidCodeValue, idResult.value],
        );
        if (existingCodeResult.rows.length > 0) {
          return badRequest(reply, 'bidCode must be unique');
        }
      }

      if (startDate && endDate) {
        const start = new Date(startDate as string);
        const end = new Date(endDate as string);
        if (end < start) return badRequest(reply, 'endDate must be on or after startDate');
      }

      const currentBidResult = await query(
        `SELECT
                client_id as "clientId",
                product_id as "productId",
                unit_price as "unitPrice",
                start_date as "startDate",
                end_date as "endDate"
             FROM special_bids
             WHERE id = $1`,
        [idResult.value],
      );

      if (currentBidResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Special bid not found' });
      }

      const currentBid = currentBidResult.rows[0];
      const updatedClientId = clientIdValue ?? currentBid.clientId;
      const updatedProductId = productIdValue ?? currentBid.productId;
      const updatedStartDate = startDateValue ?? currentBid.startDate;
      const updatedEndDate = endDateValue ?? currentBid.endDate;
      const updatedUnitPrice = unitPriceValue ?? currentBid.unitPrice;

      if (updatedProductId) {
        const productCostResult = await query('SELECT costo FROM products WHERE id = $1', [
          updatedProductId,
        ]);
        if (productCostResult.rows.length === 0) {
          return badRequest(reply, 'productId is invalid');
        }
        const productCost = parseFloat(productCostResult.rows[0].costo);
        if (!Number.isFinite(productCost)) {
          return badRequest(reply, 'Product cost is invalid');
        }
        const normalizedUnitPrice = Number(updatedUnitPrice);
        if (!Number.isFinite(normalizedUnitPrice)) {
          return badRequest(reply, 'unitPrice must be a valid number');
        }
        if (normalizedUnitPrice <= 0) {
          return badRequest(reply, 'unitPrice must be greater than zero');
        }
        if (normalizedUnitPrice >= productCost) {
          return badRequest(reply, 'unitPrice must be less than product cost');
        }
      }

      if (updatedClientId && updatedProductId) {
        const existing = await query(
          `SELECT id FROM special_bids
                 WHERE client_id = $1
                   AND product_id = $2
                   AND id <> $3
                   AND start_date <= CURRENT_DATE
                   AND end_date >= CURRENT_DATE
                   AND $4::date <= CURRENT_DATE
                   AND $5::date >= CURRENT_DATE`,
          [updatedClientId, updatedProductId, idResult.value, updatedStartDate, updatedEndDate],
        );
        if (existing.rows.length > 0) {
          return reply
            .code(409)
            .send({ error: 'An active special bid already exists for this client and product' });
        }
      }

      const result = await query(
        `UPDATE special_bids
             SET bid_code = COALESCE($1, bid_code),
                 client_id = COALESCE($2, client_id),
                 client_name = COALESCE($3, client_name),
                 product_id = COALESCE($4, product_id),
                 product_name = COALESCE($5, product_name),
                 unit_price = COALESCE($6, unit_price),
                 mol_percentage = COALESCE($7, mol_percentage),
                 start_date = COALESCE($8, start_date),
                 end_date = COALESCE($9, end_date),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $10
             RETURNING
                id,
                bid_code as "bidCode",
                client_id as "clientId",
                client_name as "clientName",
                product_id as "productId",
                product_name as "productName",
                unit_price as "unitPrice",
                mol_percentage as "molPercentage",
                start_date as "startDate",
                end_date as "endDate",
                EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
                EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
        [
          bidCodeValue,
          clientIdValue,
          clientNameValue,
          productIdValue,
          productNameValue,
          unitPriceValue,
          molPercentageValue,
          startDateValue,
          endDateValue,
          idResult.value,
        ],
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Special bid not found' });
      }

      return result.rows[0];
    },
  );

  fastify.delete(
    '/:id',
    {
      onRequest: [requirePermission('catalog.special_bids.delete')],
      schema: {
        tags: ['special-bids'],
        summary: 'Delete special bid',
        params: idParamSchema,
        response: {
          204: { type: 'null' },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as unknown as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      const result = await query('DELETE FROM special_bids WHERE id = $1 RETURNING id', [
        idResult.value,
      ]);

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Special bid not found' });
      }

      return reply.code(204).send();
    },
  );
}
