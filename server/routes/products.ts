import { query } from '../db/index.ts';
import { authenticateToken, requireRole } from '../middleware/auth.ts';
import { requireNonEmptyString, optionalNonEmptyString, parseNonNegativeNumber, parseBoolean, validateEnum, optionalEnum, badRequest } from '../utils/validation.ts';

export default async function (fastify, opts) {
    // All product routes require manager role
    fastify.addHook('onRequest', authenticateToken);
    fastify.addHook('onRequest', requireRole('manager'));

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

        const nameResult = requireNonEmptyString(name, 'name');
        if (!nameResult.ok) return badRequest(reply, nameResult.message);

        if (costo === undefined || costo === null || costo === '') {
            return badRequest(reply, 'costo is required');
        }
        const costoResult = parseNonNegativeNumber(costo, 'costo');
        if (!costoResult.ok) return badRequest(reply, costoResult.message);

        if (molPercentage === undefined || molPercentage === null || molPercentage === '') {
            return badRequest(reply, 'molPercentage is required');
        }
        const molPercentageResult = parseNonNegativeNumber(molPercentage, 'molPercentage');
        if (!molPercentageResult.ok) return badRequest(reply, molPercentageResult.message);

        if (taxRate === undefined || taxRate === null || taxRate === '') {
            return badRequest(reply, 'taxRate is required');
        }
        const taxRateResult = parseNonNegativeNumber(taxRate, 'taxRate');
        if (!taxRateResult.ok) return badRequest(reply, taxRateResult.message);

        if (costUnit === undefined || costUnit === null || costUnit === '') {
            return badRequest(reply, 'costUnit is required');
        }
        const costUnitResult = validateEnum(costUnit, ['unit', 'hours'], 'costUnit');
        if (!costUnitResult.ok) return badRequest(reply, costUnitResult.message);

        if (type === undefined || type === null || type === '') {
            return badRequest(reply, 'type is required');
        }
        const typeResult = validateEnum(type, ['item', 'service'], 'type');
        if (!typeResult.ok) return badRequest(reply, typeResult.message);

        const id = 'p-' + Date.now();
        const result = await query(
            `INSERT INTO products (id, name, costo, mol_percentage, cost_unit, category, tax_rate, type, supplier_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
             RETURNING id, name, costo, mol_percentage as "molPercentage", cost_unit as "costUnit", category, tax_rate as "taxRate", type, supplier_id as "supplierId"`,
            [id, nameResult.value, costoResult.value, molPercentageResult.value, costUnitResult.value, category, taxRateResult.value, typeResult.value, supplierId || null]
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
        const idResult = requireNonEmptyString(id, 'id');
        if (!idResult.ok) return badRequest(reply, idResult.message);

        if (name !== undefined) {
            const nameResult = optionalNonEmptyString(name, 'name');
            if (!nameResult.ok) return badRequest(reply, nameResult.message);
        }

        let costoValue = costo;
        if (costo !== undefined) {
            const costoResult = parseNonNegativeNumber(costo, 'costo');
            if (!costoResult.ok) return badRequest(reply, costoResult.message);
            costoValue = costoResult.value;
        }

        let molPercentageValue = molPercentage;
        if (molPercentage !== undefined) {
            const molPercentageResult = parseNonNegativeNumber(molPercentage, 'molPercentage');
            if (!molPercentageResult.ok) return badRequest(reply, molPercentageResult.message);
            molPercentageValue = molPercentageResult.value;
        }

        let taxRateValue = taxRate;
        if (taxRate !== undefined) {
            const taxRateResult = parseNonNegativeNumber(taxRate, 'taxRate');
            if (!taxRateResult.ok) return badRequest(reply, taxRateResult.message);
            taxRateValue = taxRateResult.value;
        }

        const costUnitResult = optionalEnum(costUnit, ['unit', 'hours'], 'costUnit');
        if (!costUnitResult.ok) return badRequest(reply, costUnitResult.message);

        const typeResult = optionalEnum(type, ['item', 'service'], 'type');
        if (!typeResult.ok) return badRequest(reply, typeResult.message);

        const isDisabledValue = isDisabled !== undefined ? parseBoolean(isDisabled) : undefined;

        const result = await query(
            `UPDATE products 
             SET name = COALESCE($1, name), 
                 costo = COALESCE($2, costo), 
                 mol_percentage = COALESCE($3, mol_percentage), 
                 cost_unit = COALESCE($4, cost_unit), 
                 category = COALESCE($5, category), 
                 tax_rate = COALESCE($6, tax_rate),
                 type = COALESCE($7, type),
                 is_disabled = COALESCE($8, is_disabled),
                 supplier_id = COALESCE($9, supplier_id)
             WHERE id = $10 
             RETURNING id, name, costo, mol_percentage as "molPercentage", cost_unit as "costUnit", category, tax_rate as "taxRate", type, is_disabled as "isDisabled", supplier_id as "supplierId"`,
            [name, costoValue, molPercentageValue, costUnitResult.value, category, taxRateValue, typeResult.value, isDisabledValue, supplierId !== undefined ? supplierId : null, idResult.value]
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
        const idResult = requireNonEmptyString(id, 'id');
        if (!idResult.ok) return badRequest(reply, idResult.message);

        const result = await query('DELETE FROM products WHERE id = $1 RETURNING id', [idResult.value]);

        if (result.rows.length === 0) {
            return reply.code(404).send({ error: 'Product not found' });
        }

        return reply.code(204).send();
    });
}
