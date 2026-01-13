import express from 'express';
import { query } from '../db/index.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// All product routes require at least manager role
router.use(authenticateToken);
router.use(requireRole('admin', 'manager'));

// List all products
router.get('/', async (req, res, next) => {
    try {
        const result = await query(
            'SELECT id, name, sale_price as "salePrice", sale_unit as "saleUnit", cost, cost_unit as "costUnit", category, tax_rate as "taxRate", is_disabled as "isDisabled" FROM products ORDER BY name ASC'
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// Create product
router.post('/', async (req, res, next) => {
    const { name, salePrice, saleUnit, cost, costUnit, category, taxRate } = req.body;

    if (!name) {
        return res.status(400).json({ error: 'Product name is required' });
    }

    try {
        const id = 'p-' + Date.now();
        const result = await query(
            'INSERT INTO products (id, name, sale_price, sale_unit, cost, cost_unit, category, tax_rate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, name, sale_price as "salePrice", sale_unit as "saleUnit", cost, cost_unit as "costUnit", category, tax_rate as "taxRate"',
            [id, name, salePrice || 0, saleUnit || 'unit', cost || 0, costUnit || 'unit', category, taxRate || 0]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

// Update product
router.put('/:id', async (req, res, next) => {
    const { id } = req.params;
    const { name, salePrice, saleUnit, cost, costUnit, category, taxRate, isDisabled } = req.body;

    try {
        const result = await query(
            `UPDATE products 
             SET name = COALESCE($1, name), 
                 sale_price = COALESCE($2, sale_price), 
                 sale_unit = COALESCE($3, sale_unit), 
                 cost = COALESCE($4, cost), 
                 cost_unit = COALESCE($5, cost_unit), 
                 category = COALESCE($6, category), 
                 tax_rate = COALESCE($7, tax_rate),
                 is_disabled = COALESCE($8, is_disabled)
             WHERE id = $9 
             RETURNING id, name, sale_price as "salePrice", sale_unit as "saleUnit", cost, cost_unit as "costUnit", category, tax_rate as "taxRate", is_disabled as "isDisabled"`,
            [name, salePrice, saleUnit, cost, costUnit, category, taxRate, isDisabled, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

// Delete product
router.delete('/:id', async (req, res, next) => {
    const { id } = req.params;

    try {
        const result = await query('DELETE FROM products WHERE id = $1 RETURNING id', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        res.status(204).send();
    } catch (err) {
        next(err);
    }
});

export default router;
