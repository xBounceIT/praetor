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

export default async function (fastify, _opts) {
  // All sales routes require manager role
  fastify.addHook('onRequest', authenticateToken);
  fastify.addHook('onRequest', requireRole('manager'));

  // GET / - List all sales with their items
  fastify.get('/', async (_request, _reply) => {
    // Get all sales
    const salesResult = await query(
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
            FROM sales 
            ORDER BY created_at DESC`,
    );

    // Get all sale items
    const itemsResult = await query(
      `SELECT 
                id,
                sale_id as "saleId",
                product_id as "productId",
                product_name as "productName",
                special_bid_id as "specialBidId",
                quantity,
                unit_price as "unitPrice",
                note,
                discount
            FROM sale_items
            ORDER BY created_at ASC`,
    );

    // Group items by sale
    const itemsBySale = {};
    itemsResult.rows.forEach((item) => {
      if (!itemsBySale[item.saleId]) {
        itemsBySale[item.saleId] = [];
      }
      itemsBySale[item.saleId].push(item);
    });

    // Attach items to sales
    const sales = salesResult.rows.map((sale) => ({
      ...sale,
      items: itemsBySale[sale.id] || [],
    }));

    return sales;
  });

  // POST / - Create sale with items
  fastify.post('/', async (request, reply) => {
    const { linkedQuoteId, clientId, clientName, items, paymentTerms, discount, status, notes } =
      request.body;

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
      const productNameResult = requireNonEmptyString(item.productName, `items[${i}].productName`);
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
        discount: itemDiscountResult.value || 0,
      });
    }

    const discountResult = optionalLocalizedNonNegativeNumber(discount, 'discount');
    if (!discountResult.ok) return badRequest(reply, discountResult.message);

    const saleId = 's-' + Date.now();

    // Insert sale
    const saleResult = await query(
      `INSERT INTO sales (id, linked_quote_id, client_id, client_name, payment_terms, discount, status, notes) 
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
        saleId,
        linkedQuoteId || null,
        clientIdResult.value,
        clientNameResult.value,
        paymentTerms || 'immediate',
        discountResult.value || 0,
        status || 'draft',
        notes,
      ],
    );

    // Insert sale items
    const createdItems = [];
    for (const item of normalizedItems) {
      const itemId = 'si-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
      const itemResult = await query(
        `INSERT INTO sale_items (id, sale_id, product_id, product_name, special_bid_id, quantity, unit_price, discount, note) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
                 RETURNING 
                    id,
                    sale_id as "saleId",
                    product_id as "productId",
                    product_name as "productName",
                    special_bid_id as "specialBidId",
                    quantity,
                    unit_price as "unitPrice",
                    discount,
                    note`,
        [
          itemId,
          saleId,
          item.productId,
          item.productName,
          item.specialBidId || null,
          item.quantity,
          item.unitPrice,
          item.discount || 0,
          item.note || null,
        ],
      );
      createdItems.push(itemResult.rows[0]);
    }

    return reply.code(201).send({
      ...saleResult.rows[0],
      items: createdItems,
    });
  });

  // PUT /:id - Update sale
  fastify.put('/:id', async (request, reply) => {
    const { id } = request.params;
    const { clientId, clientName, items, paymentTerms, discount, status, notes } = request.body;
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

    const normalizeNotesValue = (value: string | null | undefined) => (value ?? '').toString();
    const normalizeSpecialBidId = (value: string | null | undefined) =>
      value ? value.toString() : '';
    const normalizeItemsForUpdate = (itemsToNormalize: unknown[]) => {
      if (!Array.isArray(itemsToNormalize) || itemsToNormalize.length === 0) {
        badRequest(reply, 'Items must be a non-empty array');
        return null;
      }

      const normalizedItems = [];
      for (let i = 0; i < itemsToNormalize.length; i++) {
        const item = itemsToNormalize[i];
        const productNameResult = requireNonEmptyString(
          item.productName,
          `items[${i}].productName`,
        );
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
          discount: itemDiscountResult.value || 0,
        });
      }

      return normalizedItems;
    };

    const normalizeItemsForComparison = (itemsToNormalize: (typeof items)[number][]) => {
      return itemsToNormalize
        .map((item) => {
          const normalized = {
            id: item.id ? item.id.toString() : '',
            productId: item.productId ? item.productId.toString() : '',
            productName: item.productName ? item.productName.toString() : '',
            specialBidId: normalizeSpecialBidId(item.specialBidId),
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
      leftItems: (typeof items)[number][],
      rightItems: (typeof items)[number][],
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

    let normalizedItems: (typeof items)[number][] | null = null;
    if (items !== undefined) {
      normalizedItems = normalizeItemsForUpdate(items);
      if (!normalizedItems) return;
    }

    const existingSaleResult = await query(
      `SELECT 
                    id,
                    linked_quote_id as "linkedQuoteId",
                    client_id as "clientId",
                    client_name as "clientName",
                    payment_terms as "paymentTerms",
                    discount,
                    status,
                    notes
                FROM sales
                WHERE id = $1`,
      [idResult.value],
    );

    if (existingSaleResult.rows.length === 0) {
      return reply.code(404).send({ error: 'Sale not found' });
    }

    const existingSale = existingSaleResult.rows[0];
    let existingItems: (typeof items)[number][] | null = null;

    // Check if sale is read-only (non-draft status)
    // Status changes are always allowed, but other field changes are blocked for non-draft sales
    const isStatusChangeOnly =
      status !== undefined &&
      clientIdValue === undefined &&
      clientNameValue === undefined &&
      paymentTerms === undefined &&
      discountValue === undefined &&
      notes === undefined &&
      items === undefined;

    if (existingSale.status !== 'draft' && !isStatusChangeOnly) {
      return reply.code(409).send({
        error: 'Non-draft sales are read-only',
        currentStatus: existingSale.status,
      });
    }

    if (existingSale.linkedQuoteId) {
      const lockedFields: string[] = [];

      if (
        clientIdValue !== undefined &&
        clientIdValue !== null &&
        clientIdValue !== existingSale.clientId
      ) {
        lockedFields.push('clientId');
      }

      if (
        clientNameValue !== undefined &&
        clientNameValue !== null &&
        clientNameValue !== existingSale.clientName
      ) {
        lockedFields.push('clientName');
      }

      if (
        paymentTerms !== undefined &&
        paymentTerms !== null &&
        paymentTerms !== existingSale.paymentTerms
      ) {
        lockedFields.push('paymentTerms');
      }

      if (
        discountValue !== undefined &&
        discountValue !== null &&
        Number(discountValue) !== Number(existingSale.discount)
      ) {
        lockedFields.push('discount');
      }

      if (
        notes !== undefined &&
        normalizeNotesValue(notes) !== normalizeNotesValue(existingSale.notes)
      ) {
        lockedFields.push('notes');
      }

      if (items !== undefined) {
        const itemsResult = await query(
          `SELECT 
                            id,
                            sale_id as "saleId",
                            product_id as "productId",
                            product_name as "productName",
                            special_bid_id as "specialBidId",
                            quantity,
                            unit_price as "unitPrice",
                            discount
                        FROM sale_items
                        WHERE sale_id = $1`,
          [idResult.value],
        );
        existingItems = itemsResult.rows;

        const normalizedExistingItems = normalizeItemsForComparison(existingItems);
        const normalizedIncomingItems = normalizeItemsForComparison(normalizedItems ?? []);
        if (!itemsMatch(normalizedExistingItems, normalizedIncomingItems)) {
          lockedFields.push('items');
        }
      }

      if (lockedFields.length > 0) {
        return reply.code(409).send({
          error: 'Quote-linked sale details are read-only',
          fields: lockedFields,
        });
      }
    }

    // Update sale
    const saleResult = await query(
      `UPDATE sales 
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
      [clientIdValue, clientNameValue, paymentTerms, discountValue, status, notes, idResult.value],
    );

    if (saleResult.rows.length === 0) {
      return reply.code(404).send({ error: 'Sale not found' });
    }

    // If items are provided, update them
    let updatedItems = [];
    if (existingSale.linkedQuoteId) {
      if (existingItems) {
        updatedItems = existingItems;
      } else {
        const itemsResult = await query(
          `SELECT 
                        id,
                        sale_id as "saleId",
                        product_id as "productId",
                        product_name as "productName",
                        special_bid_id as "specialBidId",
                        quantity,
                        unit_price as "unitPrice",
                        discount,
                        note
                    FROM sale_items
                    WHERE sale_id = $1`,
          [idResult.value],
        );
        updatedItems = itemsResult.rows;
      }
    } else if (items !== undefined) {
      if (!normalizedItems) return;
      // Delete existing items
      await query('DELETE FROM sale_items WHERE sale_id = $1', [idResult.value]);

      // Insert new items
      for (const item of normalizedItems) {
        const itemId = 'si-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        const itemResult = await query(
          `INSERT INTO sale_items (id, sale_id, product_id, product_name, special_bid_id, quantity, unit_price, discount, note) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
                     RETURNING 
                        id,
                        sale_id as "saleId",
                        product_id as "productId",
                        product_name as "productName",
                        special_bid_id as "specialBidId",
                        quantity,
                        unit_price as "unitPrice",
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
                    sale_id as "saleId",
                    product_id as "productId",
                    product_name as "productName",
                    special_bid_id as "specialBidId",
                    quantity,
                    unit_price as "unitPrice",
                    discount,
                    note
                FROM sale_items
                WHERE sale_id = $1`,
        [idResult.value],
      );
      updatedItems = itemsResult.rows;
    }

    // Auto-create projects when sale is confirmed for the first time
    if (status === 'confirmed' && existingSale.status !== 'confirmed') {
      // Fetch sale items with notes for project creation
      const saleItemsResult = await query(
        `SELECT product_id, product_name, note FROM sale_items WHERE sale_id = $1`,
        [idResult.value],
      );

      // Get the sale year from created_at
      const saleYear = new Date(saleResult.rows[0].createdAt).getFullYear();

      // Create a project for each sale item
      for (const saleItem of saleItemsResult.rows) {
        const projectName = `${saleResult.rows[0].clientName}_${saleItem.product_name}_${saleYear}`;

        // Check if project with this exact name already exists for this client
        const existingProject = await query(
          `SELECT id FROM projects WHERE name = $1 AND client_id = $2`,
          [projectName, saleResult.rows[0].clientId],
        );

        if (existingProject.rows.length === 0) {
          const projectId = 'p-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
          await query(
            `INSERT INTO projects (id, name, client_id, color, description, is_disabled) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              projectId,
              projectName,
              saleResult.rows[0].clientId,
              getRandomColor(),
              saleItem.note || null,
              false,
            ],
          );
        }
      }
    }

    return {
      ...saleResult.rows[0],
      items: updatedItems,
    };
  });

  // DELETE /:id - Delete sale (only allowed for draft status)
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params;
    const idResult = requireNonEmptyString(id, 'id');
    if (!idResult.ok) return badRequest(reply, idResult.message);

    // Check if sale exists and is in draft status
    const saleResult = await query('SELECT id, status FROM sales WHERE id = $1', [idResult.value]);

    if (saleResult.rows.length === 0) {
      return reply.code(404).send({ error: 'Sale not found' });
    }

    const sale = saleResult.rows[0];
    if (sale.status !== 'draft') {
      return reply.code(409).send({
        error: 'Only draft sales can be deleted',
        currentStatus: sale.status,
      });
    }

    // Items will be deleted automatically via CASCADE
    await query('DELETE FROM sales WHERE id = $1', [idResult.value]);

    return reply.code(204).send();
  });
}
