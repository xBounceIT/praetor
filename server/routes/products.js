import { query } from '../db/index.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

export default async function (fastify, opts) {
    // All product routes require at least manager role
    fastify.addHook('onRequest', authenticateToken);
    fastify.addHook('onRequest', requireRole('admin', 'manager'));

    // GET / - List all products
    fastify.get('/', async (request, reply) => {
        const result = await query(
            'SELECT id, name, costo, mol_percentage as "molPercentage", cost_unit as "costUnit", category, tax_rate as "taxRate", type, is_disabled as "isDisabled" FROM products ORDER BY name ASC'
        );
        return result.rows;
    });

    // POST / - Create product
    fastify.post('/', async (request, reply) => {
        const { name, costo, molPercentage, costUnit, category, taxRate, type } = request.body;

        if (!name) {
            return reply.code(400).send({ error: 'Product name is required' });
        }

        const id = 'p-' + Date.now();
        const result = await query(
            'INSERT INTO products (id, name, costo, mol_percentage, cost_unit, category, tax_rate, type) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, name, costo, mol_percentage as "molPercentage", cost_unit as "costUnit", category, tax_rate as "taxRate", type',
            [id, name, costo || 0, molPercentage || 0, costUnit || 'unit', category, taxRate || 0, type || 'item']
        );
        return reply.code(201).send(result.rows[0]);
    });

    // PUT /:id - Update product
    fastify.put('/:id', async (request, reply) => {
        const { id } = request.params;
        const { name, costo, molPercentage, costUnit, category, taxRate, type, isDisabled } = request.body;

        const result = await query(
            `UPDATE products 
             SET name = COALESCE($1, name), 
                 costo = COALESCE($2, costo), 
                 mol_percentage = COALESCE($3, mol_percentage), 
                 cost_unit = COALESCE($4, cost_unit), 
                 category = COALESCE($5, category), 
                 tax_rate = COALESCE($6, tax_rate),
                 is_disabled = COALESCE($7, is_disabled)
             WHERE id = $8 
             RETURNING id, name, costo, mol_percentage as "molPercentage", cost_unit as "costUnit", category, tax_rate as "taxRate", type, is_disabled as "isDisabled"`,
            [name, costo, molPercentage, costUnit, category, taxRate, isDisabled, id]
        );

        if (result.rows.length === 0) {
            return reply.code(404).send({ error: 'Product not found' });
        }

        return result.rows[0];
    });

    // DELETE /:id - Delete product
    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params;

        const result = await query('DELETE FROM products WHERE id = $1 RETURNING id', [id]);

        if (result.rows.length === 0) {
            return reply.code(404).send({ error: 'Product not found' });
        }

        return reply.code(204).send();
    });
}
