import express from 'express';
import { query } from '../db/index.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/clients - List all clients
router.get('/', authenticateToken, async (req, res, next) => {
    try {
        let queryText = 'SELECT id, name, is_disabled FROM clients ORDER BY name';
        let queryParams = [];

        if (req.user.role === 'user') {
            queryText = `
                SELECT c.id, c.name, c.is_disabled
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
            isDisabled: c.is_disabled
        }));
        res.json(clients);
    } catch (err) {
        next(err);
    }
});

// POST /api/clients - Create client (admin/manager only)
router.post('/', authenticateToken, requireRole('admin', 'manager'), async (req, res, next) => {
    try {
        const { name } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Client name is required' });
        }

        const id = 'c-' + Date.now();
        await query('INSERT INTO clients (id, name, is_disabled) VALUES ($1, $2, $3)', [id, name, false]);

        res.status(201).json({ id, name, isDisabled: false });
    } catch (err) {
        next(err);
    }
});

// PUT /api/clients/:id - Update client (admin/manager only)
router.put('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, isDisabled } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Client name is required' });
        }

        const result = await query(
            'UPDATE clients SET name = $1, is_disabled = $2 WHERE id = $3 RETURNING id, name, is_disabled',
            [name, isDisabled || false, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found' });
        }

        const updatedClient = result.rows[0];

        // If client is disabled, cascade to projects and tasks
        if (isDisabled === true) {
            // Disable all projects for this client
            await query('UPDATE projects SET is_disabled = true WHERE client_id = $1', [id]);

            // Disable all tasks that belong to any project of this client
            await query(`
                UPDATE tasks 
                SET is_disabled = true 
                WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1)
            `, [id]);
        }

        res.json({
            id: updatedClient.id,
            name: updatedClient.name,
            isDisabled: updatedClient.is_disabled
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
