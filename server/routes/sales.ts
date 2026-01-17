import { query } from '../db/index.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

export default async function (fastify, opts) {
    // All sales routes require at least manager role
    fastify.addHook('onRequest', authenticateToken);
    fastify.addHook('onRequest', requireRole('admin', 'manager'));

    // GET / - List all sales with their items
    fastify.get('/', async (request, reply) => {
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
            ORDER BY created_at DESC`
        );

        // Get all sale items
        const itemsResult = await query(
            `SELECT 
                id,
                sale_id as "saleId",
                product_id as "productId",
                product_name as "productName",
                quantity,
                unit_price as "unitPrice",
                discount
            FROM sale_items
            ORDER BY created_at ASC`
        );

        // Group items by sale
        const itemsBySale = {};
        itemsResult.rows.forEach(item => {
            if (!itemsBySale[item.saleId]) {
                itemsBySale[item.saleId] = [];
            }
            itemsBySale[item.saleId].push(item);
        });

        // Attach items to sales
        const sales = salesResult.rows.map(sale => ({
            ...sale,
            items: itemsBySale[sale.id] || []
        }));

        return sales;
    });

    // POST / - Create sale with items
    fastify.post('/', async (request, reply) => {
        const { linkedQuoteId, clientId, clientName, items, paymentTerms, discount, status, notes } = request.body;

        if (!clientId || !clientName || !items || items.length === 0) {
            return reply.code(400).send({ error: 'Client and items are required' });
        }

        const saleId = 's-' + Date.now();

        try {
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
                [saleId, linkedQuoteId || null, clientId, clientName, paymentTerms || 'immediate', discount || 0, status || 'pending', notes]
            );

            // Insert sale items
            const createdItems = [];
            for (const item of items) {
                const itemId = 'si-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                const itemResult = await query(
                    `INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, unit_price, discount) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7) 
                 RETURNING 
                    id,
                    sale_id as "saleId",
                    product_id as "productId",
                    product_name as "productName",
                    quantity,
                    unit_price as "unitPrice",
                    discount`,
                    [itemId, saleId, item.productId, item.productName, item.quantity, item.unitPrice, item.discount || 0]
                );
                createdItems.push(itemResult.rows[0]);
            }

            return reply.code(201).send({
                ...saleResult.rows[0],
                items: createdItems
            });
        } catch (err) {
            throw err;
        }
    });

    // PUT /:id - Update sale
    fastify.put('/:id', async (request, reply) => {
        const { id } = request.params;
        const { clientId, clientName, items, paymentTerms, discount, status, notes } = request.body;

        try {
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
                [clientId, clientName, paymentTerms, discount, status, notes, id]
            );

            if (saleResult.rows.length === 0) {
                return reply.code(404).send({ error: 'Sale not found' });
            }

            // If items are provided, update them
            let updatedItems = [];
            if (items) {
                // Delete existing items
                await query('DELETE FROM sale_items WHERE sale_id = $1', [id]);

                // Insert new items
                for (const item of items) {
                    const itemId = 'si-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                    const itemResult = await query(
                        `INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, unit_price, discount) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7) 
                     RETURNING 
                        id,
                        sale_id as "saleId",
                        product_id as "productId",
                        product_name as "productName",
                        quantity,
                        unit_price as "unitPrice",
                        discount`,
                        [itemId, id, item.productId, item.productName, item.quantity, item.unitPrice, item.discount || 0]
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
                    quantity,
                    unit_price as "unitPrice",
                    discount
                FROM sale_items
                WHERE sale_id = $1`,
                    [id]
                );
                updatedItems = itemsResult.rows;
            }

            return {
                ...saleResult.rows[0],
                items: updatedItems
            };
        } catch (err) {
            throw err;
        }
    });

    // DELETE /:id - Delete sale
    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params;

        // Items will be deleted automatically via CASCADE
        const result = await query('DELETE FROM sales WHERE id = $1 RETURNING id', [id]);

        if (result.rows.length === 0) {
            return reply.code(404).send({ error: 'Sale not found' });
        }

        return reply.code(204).send();
    });
}
