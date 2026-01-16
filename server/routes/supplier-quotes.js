import { query } from '../db/index.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

export default async function (fastify, opts) {
  fastify.addHook('onRequest', authenticateToken);
  fastify.addHook('onRequest', requireRole('admin', 'manager'));

  fastify.get('/', async () => {
    const quotesResult = await query(
      `SELECT
        id,
        supplier_id as "supplierId",
        supplier_name as "supplierName",
        purchase_order_number as "purchaseOrderNumber",
        payment_terms as "paymentTerms",
        discount,
        status,
        expiration_date as "expirationDate",
        notes,
        EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
        EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"
       FROM supplier_quotes
       ORDER BY created_at DESC`
    );

    const itemsResult = await query(
      `SELECT
        id,
        quote_id as "quoteId",
        product_id as "productId",
        product_name as "productName",
        quantity,
        unit_price as "unitPrice",
        discount,
        note
       FROM supplier_quote_items
       ORDER BY created_at ASC`
    );

    const itemsByQuote = {};
    itemsResult.rows.forEach(item => {
      if (!itemsByQuote[item.quoteId]) {
        itemsByQuote[item.quoteId] = [];
      }
      itemsByQuote[item.quoteId].push(item);
    });

    return quotesResult.rows.map(quote => ({
      ...quote,
      items: itemsByQuote[quote.id] || []
    }));
  });

  fastify.post('/', async (request, reply) => {
    const {
      supplierId,
      supplierName,
      purchaseOrderNumber,
      items,
      paymentTerms,
      discount,
      status,
      expirationDate,
      notes
    } = request.body;

    if (!supplierId || !supplierName || !purchaseOrderNumber || !items || items.length === 0 || !expirationDate) {
      return reply.code(400).send({ error: 'Supplier, PO number, items, and expiration date are required' });
    }

    const quoteId = 'sq-' + Date.now();
    const quoteResult = await query(
      `INSERT INTO supplier_quotes (
        id, supplier_id, supplier_name, purchase_order_number, payment_terms, discount, status, expiration_date, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING
        id,
        supplier_id as "supplierId",
        supplier_name as "supplierName",
        purchase_order_number as "purchaseOrderNumber",
        payment_terms as "paymentTerms",
        discount,
        status,
        expiration_date as "expirationDate",
        notes,
        EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
        EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
      [
        quoteId,
        supplierId,
        supplierName,
        purchaseOrderNumber,
        paymentTerms || 'immediate',
        discount || 0,
        status || 'received',
        expirationDate,
        notes
      ]
    );

    const createdItems = [];
    for (const item of items) {
      const itemId = 'sqi-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
      const itemResult = await query(
        `INSERT INTO supplier_quote_items (
          id, quote_id, product_id, product_name, quantity, unit_price, discount, note
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING
          id,
          quote_id as "quoteId",
          product_id as "productId",
          product_name as "productName",
          quantity,
          unit_price as "unitPrice",
          discount,
          note`,
        [
          itemId,
          quoteId,
          item.productId,
          item.productName,
          item.quantity,
          item.unitPrice,
          item.discount || 0,
          item.note || null
        ]
      );
      createdItems.push(itemResult.rows[0]);
    }

    return reply.code(201).send({
      ...quoteResult.rows[0],
      items: createdItems
    });
  });

  fastify.put('/:id', async (request, reply) => {
    const { id } = request.params;
    const {
      supplierId,
      supplierName,
      purchaseOrderNumber,
      items,
      paymentTerms,
      discount,
      status,
      expirationDate,
      notes
    } = request.body;

    const quoteResult = await query(
      `UPDATE supplier_quotes
       SET supplier_id = COALESCE($1, supplier_id),
           supplier_name = COALESCE($2, supplier_name),
           purchase_order_number = COALESCE($3, purchase_order_number),
           payment_terms = COALESCE($4, payment_terms),
           discount = COALESCE($5, discount),
           status = COALESCE($6, status),
           expiration_date = COALESCE($7, expiration_date),
           notes = COALESCE($8, notes),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $9
       RETURNING
        id,
        supplier_id as "supplierId",
        supplier_name as "supplierName",
        purchase_order_number as "purchaseOrderNumber",
        payment_terms as "paymentTerms",
        discount,
        status,
        expiration_date as "expirationDate",
        notes,
        EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
        EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
      [
        supplierId,
        supplierName,
        purchaseOrderNumber,
        paymentTerms,
        discount,
        status,
        expirationDate,
        notes,
        id
      ]
    );

    if (quoteResult.rows.length === 0) {
      return reply.code(404).send({ error: 'Supplier quote not found' });
    }

    let updatedItems = [];
    if (items) {
      await query('DELETE FROM supplier_quote_items WHERE quote_id = $1', [id]);

      for (const item of items) {
        const itemId = 'sqi-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        const itemResult = await query(
          `INSERT INTO supplier_quote_items (
            id, quote_id, product_id, product_name, quantity, unit_price, discount, note
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING
            id,
            quote_id as "quoteId",
            product_id as "productId",
            product_name as "productName",
            quantity,
            unit_price as "unitPrice",
            discount,
            note`,
          [
            itemId,
            id,
            item.productId,
            item.productName,
            item.quantity,
            item.unitPrice,
            item.discount || 0,
            item.note || null
          ]
        );
        updatedItems.push(itemResult.rows[0]);
      }
    } else {
      const itemsResult = await query(
        `SELECT
          id,
          quote_id as "quoteId",
          product_id as "productId",
          product_name as "productName",
          quantity,
          unit_price as "unitPrice",
          discount,
          note
         FROM supplier_quote_items
         WHERE quote_id = $1`,
        [id]
      );
      updatedItems = itemsResult.rows;
    }

    return {
      ...quoteResult.rows[0],
      items: updatedItems
    };
  });

  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params;
    const result = await query('DELETE FROM supplier_quotes WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Supplier quote not found' });
    }

    return reply.code(204).send();
  });
}
