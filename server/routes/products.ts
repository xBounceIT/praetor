import { query } from '../db/index.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

export default async function (fastify, opts) {
    // All product routes require at least manager role
    fastify.addHook('onRequest', authenticateToken);
    fastify.addHook('onRequest', requireRole('admin', 'manager'));

    // GET / - List all products
    fastify.get('/', async (request, reply) => {
        const result = await query(
            `SELECT p.id, p.name, p.costo, p.mol_percentage as "molPercentage", p.cost_unit as "costUnit", p.category, p.tax_rate as "taxRate", p.type, p.supplier_id as "supplierId", s.name as "supplierName", p.is_disabled as "isDisabled" 
             FROM products p 
             LEFT JOIN suppliers s ON p.supplier_id = s.id 
             ORDER BY p.name ASC`
        );
        return result.rows;
    });

    // POST / - Create product
    fastify.post('/', async (request, reply) => {
        const { name, costo, molPercentage, costUnit, category, taxRate, type, supplierId } = request.body;

        if (!name) {
            return reply.code(400).send({ error: 'Product name is required' });
        }

        const id = 'p-' + Date.now();
        const result = await query(
            `INSERT INTO products (id, name, costo, mol_percentage, cost_unit, category, tax_rate, type, supplier_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
             RETURNING id, name, costo, mol_percentage as "molPercentage", cost_unit as "costUnit", category, tax_rate as "taxRate", type, supplier_id as "supplierId"`,
            [id, name, costo || 0, molPercentage || 0, costUnit || 'unit', category, taxRate || 0, type || 'item', supplierId || null]
        );
        
        // If supplier was assigned, fetch supplier name
        if (supplierId) {
            const supplierResult = await query('SELECT name FROM suppliers WHERE id = $1', [supplierId]);
            if (supplierResult.rows.length > 0) {
                result.rows[0].supplierName = supplierResult.rows[0].name;
            }
        }
        
        return reply.code(201).send(result.rows[0]);
    });

    // PUT /:id - Update product
    fastify.put('/:id', async (request, reply) => {
        const { id } = request.params;
        const { name, costo, molPercentage, costUnit, category, taxRate, type, isDisabled, supplierId } = request.body;

        const result = await query(
            `UPDATE products 
             SET name = COALESCE($1, name), 
                 costo = COALESCE($2, costo), 
                 mol_percentage = COALESCE($3, mol_percentage), 
                 cost_unit = COALESCE($4, cost_unit), 
                 category = COALESCE($5, category), 
                 tax_rate = COALESCE($6, tax_rate),
                 is_disabled = COALESCE($7, is_disabled),
                 supplier_id = $8
             WHERE id = $9 
             RETURNING id, name, costo, mol_percentage as "molPercentage", cost_unit as "costUnit", category, tax_rate as "taxRate", type, is_disabled as "isDisabled", supplier_id as "supplierId"`,
            [name, costo, molPercentage, costUnit, category, taxRate, isDisabled, supplierId !== undefined ? supplierId : null, id]
        );

        if (result.rows.length === 0) {
            return reply.code(404).send({ error: 'Product not found' });
        }

        // If supplier was assigned, fetch supplier name
        if (result.rows[0].supplierId) {
            const supplierResult = await query('SELECT name FROM suppliers WHERE id = $1', [result.rows[0].supplierId]);
            if (supplierResult.rows.length > 0) {
                result.rows[0].supplierName = supplierResult.rows[0].name;
            }
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
