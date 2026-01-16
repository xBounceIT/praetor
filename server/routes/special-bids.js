import { query } from '../db/index.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

export default async function (fastify, opts) {
    fastify.addHook('onRequest', authenticateToken);
    fastify.addHook('onRequest', requireRole('admin', 'manager'));

    fastify.get('/', async () => {
        const result = await query(
            `SELECT 
                id,
                client_id as "clientId",
                client_name as "clientName",
                product_id as "productId",
                product_name as "productName",
                unit_price as "unitPrice",
                expiration_date as "expirationDate",
                EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
                EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"
            FROM special_bids
            ORDER BY created_at DESC`
        );
        return result.rows;
    });

    fastify.post('/', async (request, reply) => {
        const { clientId, clientName, productId, productName, unitPrice, expirationDate } = request.body;

        if (!clientId || !clientName || !productId || !productName || !expirationDate) {
            return reply.code(400).send({ error: 'Client, product, and expiration date are required' });
        }

        const existing = await query(
            'SELECT id FROM special_bids WHERE client_id = $1 AND product_id = $2',
            [clientId, productId]
        );
        if (existing.rows.length > 0) {
            return reply.code(409).send({ error: 'Special bid already exists for this client and product' });
        }

        const id = 'sb-' + Date.now();
        const result = await query(
            `INSERT INTO special_bids (id, client_id, client_name, product_id, product_name, unit_price, expiration_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING 
                id,
                client_id as "clientId",
                client_name as "clientName",
                product_id as "productId",
                product_name as "productName",
                unit_price as "unitPrice",
                expiration_date as "expirationDate",
                EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
                EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
            [id, clientId, clientName, productId, productName, unitPrice || 0, expirationDate]
        );

        return reply.code(201).send(result.rows[0]);
    });

    fastify.put('/:id', async (request, reply) => {
        const { id } = request.params;
        const { clientId, clientName, productId, productName, unitPrice, expirationDate } = request.body;

        if (clientId && productId) {
            const existing = await query(
                'SELECT id FROM special_bids WHERE client_id = $1 AND product_id = $2 AND id <> $3',
                [clientId, productId, id]
            );
            if (existing.rows.length > 0) {
                return reply.code(409).send({ error: 'Special bid already exists for this client and product' });
            }
        }

        const result = await query(
            `UPDATE special_bids
             SET client_id = COALESCE($1, client_id),
                 client_name = COALESCE($2, client_name),
                 product_id = COALESCE($3, product_id),
                 product_name = COALESCE($4, product_name),
                 unit_price = COALESCE($5, unit_price),
                 expiration_date = COALESCE($6, expiration_date),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $7
             RETURNING 
                id,
                client_id as "clientId",
                client_name as "clientName",
                product_id as "productId",
                product_name as "productName",
                unit_price as "unitPrice",
                expiration_date as "expirationDate",
                EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt",
                EXTRACT(EPOCH FROM updated_at) * 1000 as "updatedAt"`,
            [clientId, clientName, productId, productName, unitPrice, expirationDate, id]
        );

        if (result.rows.length === 0) {
            return reply.code(404).send({ error: 'Special bid not found' });
        }

        return result.rows[0];
    });

    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params;
        const result = await query('DELETE FROM special_bids WHERE id = $1 RETURNING id', [id]);

        if (result.rows.length === 0) {
            return reply.code(404).send({ error: 'Special bid not found' });
        }

        return reply.code(204).send();
    });
}
