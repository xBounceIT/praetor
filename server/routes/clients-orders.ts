import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requireRole } from '../middleware/auth.ts';
import {
  requireNonEmptyString,
  optionalNonEmptyString,
  parseLocalizedPositiveNumber,
  parseLocalizedNonNegativeNumber,
  optionalLocalizedNonNegativeNumber,
  badRequest,
} from '../utils/validation.ts';
import { standardErrorResponses } from '../schemas/common.ts';

// Project color palette for auto-created projects
const PROJECT_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#8b5cf6', // violet
  '#f59e0b', // amber
  '#ef4444', // red
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#84cc16', // lime
  '#6366f1', // indigo
  '#f97316', // orange
];

const getRandomColor = () => PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)];

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const clientOrderItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    orderId: { type: 'string' },
    productId: { type: ['string', 'null'] },
    productName: { type: 'string' },
    specialBidId: { type: ['string', 'null'] },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    productCost: { type: 'number' },
    productMolPercentage: { type: ['number', 'null'] },
    specialBidUnitPrice: { type: ['number', 'null'] },
    specialBidMolPercentage: { type: ['number', 'null'] },
    note: { type: ['string', 'null'] },
    discount: { type: 'number' },
  },
  required: ['id', 'orderId', 'productName', 'quantity', 'unitPrice', 'productCost', 'discount'],
} as const;

const clientOrderSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    linkedQuoteId: { type: ['string', 'null'] },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    paymentTerms: { type: ['string', 'null'] },
    discount: { type: 'number' },
    status: { type: 'string' },
    notes: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
    updatedAt: { type: 'number' },
    items: { type: 'array', items: clientOrderItemSchema },
  },
  required: [
    'id',
    'clientId',
    'clientName',
    'discount',
    'status',
    'createdAt',
    'updatedAt',
    'items',
  ],
} as const;

const clientOrderItemBodySchema = {
  type: 'object',
  properties: {
    productId: { type: 'string' },
    productName: { type: 'string' },
    specialBidId: { type: 'string' },
    quantity: { type: 'number' },
    unitPrice: { type: 'number' },
    productCost: { type: 'number' },
    productMolPercentage: { type: 'number' },
    specialBidUnitPrice: { type: 'number' },
    specialBidMolPercentage: { type: 'number' },
    discount: { type: 'number' },
    note: { type: 'string' },
  },
  required: ['productName', 'quantity', 'unitPrice'],
} as const;

const clientOrderCreateBodySchema = {
  type: 'object',
  properties: {
    linkedQuoteId: { type: 'string' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    items: { type: 'array', items: clientOrderItemBodySchema },
    paymentTerms: { type: 'string' },
    discount: { type: 'number' },
    status: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['clientId', 'clientName', 'items'],
} as const;

const clientOrderUpdateBodySchema = {
  type: 'object',
  properties: {
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    items: { type: 'array', items: clientOrderItemBodySchema },
    paymentTerms: { type: 'string' },
    discount: { type: 'number' },
    status: { type: 'string' },
    notes: { type: 'string' },
  },
} as const;

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // All clients_orders routes require manager role
  fastify.addHook('onRequest', authenticateToken);
  fastify.addHook('onRequest', requireRole('manager'));

  // GET / - List all clients_orders with their items
  fastify.get(
    '/',
    {
      schema: {
        tags: ['clients-orders'],
        summary: 'List client orders',
        response: {
          200: { type: 'array', items: clientOrderSchema },
          ...standardErrorResponses,
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      // Get all clients_orders
      const clients_ordersResult = await query(
        `SELECT
                id,
                linked_quote_id as "linkedQuoteId",
                client_id as "clientId",
                client_name as "clientName",
                payment_terms as "paymentTerms",
                discount,
                status,
                notes,
                EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
                EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"
            FROM clients_orders
            ORDER BY created_at DESC`,
      );

      // Get all order items
      const itemsResult = await query(
        `SELECT
                id,
                order_id as "orderId",
                product_id as "productId",
                product_name as "productName",
                special_bid_id as "specialBidId",
                quantity,
                unit_price as "unitPrice",
                product_cost as "productCost",
                product_mol_percentage as "productMolPercentage",
                special_bid_unit_price as "specialBidUnitPrice",
                special_bid_mol_percentage as "specialBidMolPercentage",
                note,
                discount
            FROM clients_order_items
            ORDER BY created_at ASC`,
      );

      // Group items by order
      const itemsByOrder: Record<string, unknown[]> = {};
      itemsResult.rows.forEach((item: { orderId: string }) => {
        if (!itemsByOrder[item.orderId]) {
          itemsByOrder[item.orderId] = [];
        }
        itemsByOrder[item.orderId].push(item);
      });

      // Attach items to clients_orders
      const clients_orders = clients_ordersResult.rows.map((order: { id: string }) => ({
        ...order,
        items: itemsByOrder[order.id] || [],
      }));

      return clients_orders;
    },
  );

  // POST / - Create order with items
  fastify.post(
    '/',
    {
      schema: {
        tags: ['clients-orders'],
        summary: 'Create client order',
        body: clientOrderCreateBodySchema,
        response: {
          201: clientOrderSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { linkedQuoteId, clientId, clientName, items, paymentTerms, discount, status, notes } =
        request.body as {
          linkedQuoteId: unknown;
          clientId: unknown;
          clientName: unknown;
          items: unknown;
          paymentTerms: unknown;
          discount: unknown;
          status: unknown;
          notes: unknown;
        };

      const clientIdResult = requireNonEmptyString(clientId, 'clientId');
      if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);

      const clientNameResult = requireNonEmptyString(clientName, 'clientName');
      if (!clientNameResult.ok) return badRequest(reply, clientNameResult.message);

      if (!Array.isArray(items) || items.length === 0) {
        return badRequest(reply, 'Items must be a non-empty array');
      }

      const normalizedItems = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const productNameResult = requireNonEmptyString(
          item.productName,
          `items[${i}].productName`,
        );
        if (!productNameResult.ok) return badRequest(reply, productNameResult.message);
        const quantityResult = parseLocalizedPositiveNumber(item.quantity, `items[${i}].quantity`);
        if (!quantityResult.ok) return badRequest(reply, quantityResult.message);
        const unitPriceResult = parseLocalizedNonNegativeNumber(
          item.unitPrice,
          `items[${i}].unitPrice`,
        );
        if (!unitPriceResult.ok) return badRequest(reply, unitPriceResult.message);
        const itemDiscountResult = optionalLocalizedNonNegativeNumber(
          item.discount,
          `items[${i}].discount`,
        );
        if (!itemDiscountResult.ok) return badRequest(reply, itemDiscountResult.message);
        normalizedItems.push({
          ...item,
          productName: productNameResult.value,
          quantity: quantityResult.value,
          unitPrice: unitPriceResult.value,
          productCost: Number(item.productCost ?? 0),
          productMolPercentage:
            item.productMolPercentage === undefined || item.productMolPercentage === null
              ? null
              : Number(item.productMolPercentage),
          specialBidUnitPrice:
            item.specialBidUnitPrice === undefined || item.specialBidUnitPrice === null
              ? null
              : Number(item.specialBidUnitPrice),
          specialBidMolPercentage:
            item.specialBidMolPercentage === undefined || item.specialBidMolPercentage === null
              ? null
              : Number(item.specialBidMolPercentage),
          discount: itemDiscountResult.value || 0,
        });
      }

      const discountResult = optionalLocalizedNonNegativeNumber(discount, 'discount');
      if (!discountResult.ok) return badRequest(reply, discountResult.message);

      const orderId = 's-' + Date.now();

      // Insert order
      const orderResult = await query(
        `INSERT INTO clients_orders (id, linked_quote_id, client_id, client_name, payment_terms, discount, status, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING
                id,
                linked_quote_id as "linkedQuoteId",
                client_id as "clientId",
                client_name as "clientName",
                payment_terms as "paymentTerms",
                discount,
                status,
                notes,
                EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
                EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
        [
          orderId,
          linkedQuoteId || null,
          clientIdResult.value,
          clientNameResult.value,
          paymentTerms || 'immediate',
          discountResult.value || 0,
          status || 'draft',
          notes,
        ],
      );

      // Insert order items
      const createdItems = [];
      for (const item of normalizedItems) {
        const itemId = 'si-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        const itemResult = await query(
          `INSERT INTO clients_order_items (id, order_id, product_id, product_name, special_bid_id, quantity, unit_price, product_cost, product_mol_percentage, special_bid_unit_price, special_bid_mol_percentage, discount, note)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                 RETURNING
                    id,
                    order_id as "orderId",
                    product_id as "productId",
                    product_name as "productName",
                    special_bid_id as "specialBidId",
                    quantity,
                    unit_price as "unitPrice",
                    product_cost as "productCost",
                    product_mol_percentage as "productMolPercentage",
                    special_bid_unit_price as "specialBidUnitPrice",
                    special_bid_mol_percentage as "specialBidMolPercentage",
                    discount,
                    note`,
          [
            itemId,
            orderId,
            item.productId,
            item.productName,
            item.specialBidId || null,
            item.quantity,
            item.unitPrice,
            item.productCost,
            item.productMolPercentage ?? null,
            item.specialBidUnitPrice ?? null,
            item.specialBidMolPercentage ?? null,
            item.discount || 0,
            item.note || null,
          ],
        );
        createdItems.push(itemResult.rows[0]);
      }

      return reply.code(201).send({
        ...orderResult.rows[0],
        items: createdItems,
      });
    },
  );

  // PUT /:id - Update order
  fastify.put(
    '/:id',
    {
      schema: {
        tags: ['clients-orders'],
        summary: 'Update client order',
        params: idParamSchema,
        body: clientOrderUpdateBodySchema,
        response: {
          200: clientOrderSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { clientId, clientName, items, paymentTerms, discount, status, notes } =
        request.body as {
          clientId: unknown;
          clientName: unknown;
          items: unknown;
          paymentTerms: unknown;
          discount: unknown;
          status: unknown;
          notes: unknown;
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

      let discountValue = discount;
      if (discount !== undefined) {
        const discountResult = optionalLocalizedNonNegativeNumber(discount, 'discount');
        if (!discountResult.ok) return badRequest(reply, discountResult.message);
        discountValue = discountResult.value;
      }

      const normalizeNotesValue = (value: unknown) => String(value ?? '');
      const normalizeSpecialBidId = (value: unknown) => (value ? String(value) : '');
      const normalizeItemsForUpdate = (itemsToNormalize: unknown[]) => {
        if (!Array.isArray(itemsToNormalize) || itemsToNormalize.length === 0) {
          badRequest(reply, 'Items must be a non-empty array');
          return null;
        }

        const normalizedItems: Record<string, unknown>[] = [];
        for (let i = 0; i < itemsToNormalize.length; i++) {
          const item = itemsToNormalize[i] as Record<string, unknown>;
          const productNameResult = requireNonEmptyString(
            item.productName,
            `items[${i}].productName`,
          );
          if (!productNameResult.ok) {
            badRequest(reply, productNameResult.message);
            return null;
          }
          const quantityResult = parseLocalizedPositiveNumber(
            item.quantity,
            `items[${i}].quantity`,
          );
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
          const itemDiscountResult = optionalLocalizedNonNegativeNumber(
            item.discount,
            `items[${i}].discount`,
          );
          if (!itemDiscountResult.ok) {
            badRequest(reply, itemDiscountResult.message);
            return null;
          }
          normalizedItems.push({
            ...item,
            productName: productNameResult.value,
            quantity: quantityResult.value,
            unitPrice: unitPriceResult.value,
            productCost: Number(item.productCost ?? 0),
            productMolPercentage:
              item.productMolPercentage === undefined || item.productMolPercentage === null
                ? null
                : Number(item.productMolPercentage),
            specialBidUnitPrice:
              item.specialBidUnitPrice === undefined || item.specialBidUnitPrice === null
                ? null
                : Number(item.specialBidUnitPrice),
            specialBidMolPercentage:
              item.specialBidMolPercentage === undefined || item.specialBidMolPercentage === null
                ? null
                : Number(item.specialBidMolPercentage),
            discount: itemDiscountResult.value || 0,
          });
        }

        return normalizedItems;
      };

      const normalizeItemsForComparison = (itemsToNormalize: Record<string, unknown>[]) => {
        return itemsToNormalize
          .map((item) => {
            const normalized = {
              id: item.id ? String(item.id) : '',
              productId: item.productId ? String(item.productId) : '',
              productName: item.productName ? String(item.productName) : '',
              specialBidId: normalizeSpecialBidId(item.specialBidId as string | null | undefined),
              quantity: Number(item.quantity),
              unitPrice: Number(item.unitPrice),
              discount:
                item.discount !== undefined && item.discount !== null ? Number(item.discount) : 0,
            };
            const sortKey =
              normalized.id ||
              `${normalized.productId}|${normalized.productName}|${normalized.specialBidId}|${normalized.quantity}|${normalized.unitPrice}|${normalized.discount}`;
            return { ...normalized, sortKey };
          })
          .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
      };

      const itemsMatch = (
        leftItems: Record<string, unknown>[],
        rightItems: Record<string, unknown>[],
      ) => {
        if (leftItems.length !== rightItems.length) {
          return false;
        }
        for (let i = 0; i < leftItems.length; i++) {
          const leftItem = leftItems[i];
          const rightItem = rightItems[i];
          if (
            leftItem.id !== rightItem.id ||
            leftItem.productId !== rightItem.productId ||
            leftItem.productName !== rightItem.productName ||
            leftItem.specialBidId !== rightItem.specialBidId ||
            leftItem.quantity !== rightItem.quantity ||
            leftItem.unitPrice !== rightItem.unitPrice ||
            leftItem.discount !== rightItem.discount
          ) {
            return false;
          }
        }
        return true;
      };

      let normalizedItems: Record<string, unknown>[] | null = null;
      if (items !== undefined) {
        normalizedItems = normalizeItemsForUpdate(items as unknown[]);
        if (!normalizedItems) return;
      }

      const existingOrderResult = await query(
        `SELECT
                    id,
                    linked_quote_id as "linkedQuoteId",
                    client_id as "clientId",
                    client_name as "clientName",
                    payment_terms as "paymentTerms",
                    discount,
                    status,
                    notes
                FROM clients_orders
                WHERE id = $1`,
        [idResult.value],
      );

      if (existingOrderResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Order not found' });
      }

      const existingOrder = existingOrderResult.rows[0];
      let existingItems: Record<string, unknown>[] | null = null;

      // Check if order is read-only (non-draft status)
      // Status changes are always allowed, but other field changes are blocked for non-draft clients_orders
      const isStatusChangeOnly =
        status !== undefined &&
        clientIdValue === undefined &&
        clientNameValue === undefined &&
        paymentTerms === undefined &&
        discountValue === undefined &&
        notes === undefined &&
        items === undefined;

      if (existingOrder.status !== 'draft' && !isStatusChangeOnly) {
        return reply.code(409).send({
          error: 'Non-draft clients_orders are read-only',
          currentStatus: existingOrder.status,
        });
      }

      if (existingOrder.linkedQuoteId) {
        const lockedFields: string[] = [];

        if (
          clientIdValue !== undefined &&
          clientIdValue !== null &&
          clientIdValue !== existingOrder.clientId
        ) {
          lockedFields.push('clientId');
        }

        if (
          clientNameValue !== undefined &&
          clientNameValue !== null &&
          clientNameValue !== existingOrder.clientName
        ) {
          lockedFields.push('clientName');
        }

        if (
          paymentTerms !== undefined &&
          paymentTerms !== null &&
          paymentTerms !== existingOrder.paymentTerms
        ) {
          lockedFields.push('paymentTerms');
        }

        if (
          discountValue !== undefined &&
          discountValue !== null &&
          Number(discountValue) !== Number(existingOrder.discount)
        ) {
          lockedFields.push('discount');
        }

        if (
          notes !== undefined &&
          normalizeNotesValue(notes) !== normalizeNotesValue(existingOrder.notes)
        ) {
          lockedFields.push('notes');
        }

        if (items !== undefined) {
          const itemsResult = await query(
            `SELECT
                            id,
                            order_id as "orderId",
                            product_id as "productId",
                            product_name as "productName",
                            special_bid_id as "specialBidId",
                            quantity,
                            unit_price as "unitPrice",
                            discount
                        FROM clients_order_items
                        WHERE order_id = $1`,
            [idResult.value],
          );
          existingItems = itemsResult.rows;

          const normalizedExistingItems = normalizeItemsForComparison(
            existingItems as Record<string, unknown>[],
          );
          const normalizedIncomingItems = normalizeItemsForComparison(
            (normalizedItems ?? []) as Record<string, unknown>[],
          );
          if (!itemsMatch(normalizedExistingItems, normalizedIncomingItems)) {
            lockedFields.push('items');
          }
        }

        if (lockedFields.length > 0) {
          return reply.code(409).send({
            error: 'Quote-linked order details are read-only',
            fields: lockedFields,
          });
        }
      }

      // Update order
      const orderResult = await query(
        `UPDATE clients_orders
             SET client_id = COALESCE($1, client_id),
                 client_name = COALESCE($2, client_name),
                 payment_terms = COALESCE($3, payment_terms),
                 discount = COALESCE($4, discount),
                 status = COALESCE($5, status),
                 notes = COALESCE($6, notes),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $7
             RETURNING
                id,
                linked_quote_id as "linkedQuoteId",
                client_id as "clientId",
                client_name as "clientName",
                payment_terms as "paymentTerms",
                discount,
                status,
                notes,
                EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
                EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
        [
          clientIdValue,
          clientNameValue,
          paymentTerms,
          discountValue,
          status,
          notes,
          idResult.value,
        ],
      );

      if (orderResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Order not found' });
      }

      // If items are provided, update them
      let updatedItems = [];
      if (existingOrder.linkedQuoteId) {
        if (existingItems) {
          updatedItems = existingItems;
        } else {
          const itemsResult = await query(
            `SELECT
                        id,
                        order_id as "orderId",
                        product_id as "productId",
                        product_name as "productName",
                        special_bid_id as "specialBidId",
                        quantity,
                        unit_price as "unitPrice",
                        discount,
                        note
                    FROM clients_order_items
                    WHERE order_id = $1`,
            [idResult.value],
          );
          updatedItems = itemsResult.rows;
        }
      } else if (items !== undefined) {
        if (!normalizedItems) return;
        // Delete existing items
        await query('DELETE FROM clients_order_items WHERE order_id = $1', [idResult.value]);

        // Insert new items
        for (const item of normalizedItems) {
          const itemId = 'si-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
          const itemResult = await query(
            `INSERT INTO clients_order_items (id, order_id, product_id, product_name, special_bid_id, quantity, unit_price, product_cost, product_mol_percentage, special_bid_unit_price, special_bid_mol_percentage, discount, note)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                     RETURNING
                        id,
                        order_id as "orderId",
                        product_id as "productId",
                        product_name as "productName",
                        special_bid_id as "specialBidId",
                        quantity,
                        unit_price as "unitPrice",
                        product_cost as "productCost",
                        product_mol_percentage as "productMolPercentage",
                        special_bid_unit_price as "specialBidUnitPrice",
                        special_bid_mol_percentage as "specialBidMolPercentage",
                        discount,
                        note`,
            [
              itemId,
              idResult.value,
              item.productId,
              item.productName,
              item.specialBidId || null,
              item.quantity,
              item.unitPrice,
              item.productCost,
              item.productMolPercentage ?? null,
              item.specialBidUnitPrice ?? null,
              item.specialBidMolPercentage ?? null,
              item.discount || 0,
              item.note || null,
            ],
          );
          updatedItems.push(itemResult.rows[0]);
        }
      } else {
        // Fetch existing items
        const itemsResult = await query(
          `SELECT
                    id,
                    order_id as "orderId",
                    product_id as "productId",
                    product_name as "productName",
                    special_bid_id as "specialBidId",
                    quantity,
                    unit_price as "unitPrice",
                    product_cost as "productCost",
                    product_mol_percentage as "productMolPercentage",
                    special_bid_unit_price as "specialBidUnitPrice",
                    special_bid_mol_percentage as "specialBidMolPercentage",
                    discount,
                    note
                FROM clients_order_items
                WHERE order_id = $1`,
          [idResult.value],
        );
        updatedItems = itemsResult.rows;
      }

      // Auto-create projects when order is confirmed for the first time
      if (status === 'confirmed' && existingOrder.status !== 'confirmed') {
        // Fetch order items with notes and product codes for project creation
        const orderItemsResult = await query(
          `SELECT si.product_id, si.product_name, si.note, p.product_code
         FROM clients_order_items si
         LEFT JOIN products p ON si.product_id = p.id
         WHERE si.order_id = $1`,
          [idResult.value],
        );

        // Get the client code for project naming
        const clientResult = await query(`SELECT client_code FROM clients WHERE id = $1`, [
          orderResult.rows[0].clientId,
        ]);
        const clientCode = clientResult.rows[0]?.client_code || orderResult.rows[0].clientId;

        // Get the order year from created_at (createdAt is returned as a numeric string from EXTRACT)
        const orderYear = new Date(Number(orderResult.rows[0].createdAt)).getFullYear();

        // Create a project for each order item
        for (const orderItem of orderItemsResult.rows) {
          const productCode = orderItem.product_code || orderItem.product_id;
          const projectName = `${clientCode}_${productCode}_${orderYear}`;

          // Check if project with this exact name already exists for this client
          const existingProject = await query(
            `SELECT id FROM projects WHERE name = $1 AND client_id = $2`,
            [projectName, orderResult.rows[0].clientId],
          );

          if (existingProject.rows.length === 0) {
            const projectId = 'p-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
            await query(
              `INSERT INTO projects (id, name, client_id, color, description, is_disabled)
             VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                projectId,
                projectName,
                orderResult.rows[0].clientId,
                getRandomColor(),
                orderItem.note || null,
                false,
              ],
            );
          }
        }

        // Create notifications for all managers except the one who confirmed the order
        const projectNames = orderItemsResult.rows.map(
          (item) => `${clientCode}_${item.product_code || item.product_id}_${orderYear}`,
        );

        // Get all managers except the current user
        const managersResult = await query(
          `SELECT id FROM users WHERE role = 'manager' AND id != $1 AND is_disabled = FALSE`,
          [request.user!.id],
        );

        // Create a notification for each manager
        for (const manager of managersResult.rows) {
          const notificationId = 'n-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
          await query(
            `INSERT INTO notifications (id, user_id, type, title, message, data)
           VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              notificationId,
              manager.id,
              'new_projects',
              `${projectNames.length} new project${projectNames.length > 1 ? 's' : ''} available`,
              `New projects created from order confirmation`,
              JSON.stringify({
                projectNames,
                orderId: idResult.value,
                clientName: orderResult.rows[0].clientName,
              }),
            ],
          );
        }
      }

      return {
        ...orderResult.rows[0],
        items: updatedItems,
      };
    },
  );

  // DELETE /:id - Delete order (only allowed for draft status)
  fastify.delete(
    '/:id',
    {
      schema: {
        tags: ['clients-orders'],
        summary: 'Delete client order',
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

      // Check if order exists and is in draft status
      const orderResult = await query('SELECT id, status FROM clients_orders WHERE id = $1', [
        idResult.value,
      ]);

      if (orderResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Order not found' });
      }

      const order = orderResult.rows[0];
      if (order.status !== 'draft') {
        return reply.code(409).send({
          error: 'Only draft clients_orders can be deleted',
          currentStatus: order.status,
        });
      }

      // Items will be deleted automatically via CASCADE
      await query('DELETE FROM clients_orders WHERE id = $1', [idResult.value]);

      return reply.code(204).send();
    },
  );
}
