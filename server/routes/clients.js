import express from 'express';
import { query } from '../db/index.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/clients - List all clients
router.get('/', authenticateToken, async (req, res, next) => {
    try {
        let queryText = 'SELECT * FROM clients ORDER BY name';
        let queryParams = [];

        if (req.user.role === 'user') {
            queryText = `
                SELECT c.*
                FROM clients c
                INNER JOIN user_clients uc ON c.id = uc.client_id
                WHERE uc.user_id = $1
                ORDER BY c.name
            `;
            queryParams = [req.user.id];
        }

        const result = await query(queryText, queryParams);
        const clients = result.rows.map(c => ({
            id: c.id,
            name: c.name,
            isDisabled: c.is_disabled,
            type: c.type,
            contactName: c.contact_name,
            clientCode: c.client_code,
            email: c.email,
            phone: c.phone,
            address: c.address,
            vatNumber: c.vat_number,
            taxCode: c.tax_code,
            billingCode: c.billing_code,
            paymentTerms: c.payment_terms
        }));
        res.json(clients);
    } catch (err) {
        next(err);
    }
});

// POST /api/clients - Create client (admin/manager only)
router.post('/', authenticateToken, requireRole('admin', 'manager'), async (req, res, next) => {
    try {
        const {
            name, type, contactName, clientCode, email, phone,
            address, vatNumber, taxCode, billingCode, paymentTerms
        } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Client name is required' });
        }

        const id = 'c-' + Date.now();
        await query(`
            INSERT INTO clients (
                id, name, is_disabled, type, contact_name, client_code, 
                email, phone, address, vat_number, tax_code, billing_code, payment_terms
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `, [
            id, name, false, type || 'company', contactName, clientCode,
            email, phone, address, vatNumber, taxCode, billingCode, paymentTerms
        ]);

        res.status(201).json({
            id, name, isDisabled: false, type, contactName, clientCode,
            email, phone, address, vatNumber, taxCode, billingCode, paymentTerms
        });
    } catch (err) {
        next(err);
    }
});

// PUT /api/clients/:id - Update client (admin/manager only)
router.put('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res, next) => {
    try {
        const { id } = req.params;
        const {
            name, isDisabled, type, contactName, clientCode, email, phone,
            address, vatNumber, taxCode, billingCode, paymentTerms
        } = req.body;

        const result = await query(`
            UPDATE clients SET 
                name = COALESCE($1, name), 
                is_disabled = COALESCE($2, is_disabled),
                type = COALESCE($3, type),
                contact_name = COALESCE($4, contact_name),
                client_code = COALESCE($5, client_code),
                email = COALESCE($6, email),
                phone = COALESCE($7, phone),
                address = COALESCE($8, address),
                vat_number = COALESCE($9, vat_number),
                tax_code = COALESCE($10, tax_code),
                billing_code = COALESCE($11, billing_code),
                payment_terms = COALESCE($12, payment_terms)
            WHERE id = $13 
            RETURNING *
        `, [
            name || null, isDisabled, type, contactName, clientCode, email, phone,
            address, vatNumber, taxCode, billingCode, paymentTerms, id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found' });
        }

        const c = result.rows[0];

        res.json({
            id: c.id,
            name: c.name,
            isDisabled: c.is_disabled,
            type: c.type,
            contactName: c.contact_name,
            clientCode: c.client_code,
            email: c.email,
            phone: c.phone,
            address: c.address,
            vatNumber: c.vat_number,
            taxCode: c.tax_code,
            billingCode: c.billing_code,
            paymentTerms: c.payment_terms
        });
    } catch (err) {
        next(err);
    }
});

// DELETE /api/clients/:id - Delete client (admin only)
router.delete('/:id', authenticateToken, requireRole('admin'), async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await query('DELETE FROM clients WHERE id = $1 RETURNING id', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found' });
        }

        res.json({ message: 'Client deleted' });
    } catch (err) {
        next(err);
    }
});

export default router;
