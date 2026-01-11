import express from 'express';
import { query } from '../db/index.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/projects - List all projects
router.get('/', authenticateToken, async (req, res, next) => {
    try {
        let queryText = `
            SELECT id, name, client_id, color, description, is_disabled 
            FROM projects ORDER BY name
        `;
        let queryParams = [];

        if (req.user.role === 'user') {
            queryText = `
                SELECT p.id, p.name, p.client_id, p.color, p.description, p.is_disabled 
                FROM projects p
                INNER JOIN user_projects up ON p.id = up.project_id
                WHERE up.user_id = $1
                ORDER BY p.name
            `;
            queryParams = [req.user.id];
        }

        const result = await query(queryText, queryParams);

        const projects = result.rows.map(p => ({
            id: p.id,
            name: p.name,
            clientId: p.client_id,
            color: p.color,
            description: p.description,
            isDisabled: p.is_disabled
        }));

        res.json(projects);
    } catch (err) {
        next(err);
    }
});

// POST /api/projects - Create project (admin/manager only)
router.post('/', authenticateToken, requireRole('admin', 'manager'), async (req, res, next) => {
    try {
        const { name, clientId, description, color } = req.body;

        if (!name || !clientId) {
            return res.status(400).json({ error: 'Project name and client ID are required' });
        }

        const id = 'p-' + Date.now();
        const projectColor = color || '#3b82f6';

        await query(
            `INSERT INTO projects (id, name, client_id, color, description, is_disabled) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
            [id, name, clientId, projectColor, description || null, false]
        );

        res.status(201).json({
            id,
            name,
            clientId,
            color: projectColor,
            description,
            isDisabled: false
        });
    } catch (err) {
        if (err.code === '23503') { // Foreign key violation
            return res.status(400).json({ error: 'Client not found' });
        }
        next(err);
    }
});

// DELETE /api/projects/:id - Delete project (admin/manager only)
router.delete('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await query('DELETE FROM projects WHERE id = $1 RETURNING id', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }

        res.json({ message: 'Project deleted' });
    } catch (err) {
        next(err);
    }
});

// PUT /api/projects/:id - Update project (admin/manager only)
router.put('/:id', authenticateToken, requireRole('admin', 'manager'), async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, clientId, description, color, isDisabled } = req.body;

        if (!name || !clientId) {
            return res.status(400).json({ error: 'Project name and client ID are required' });
        }

        const projectColor = color || '#3b82f6';

        const result = await query(
            `UPDATE projects 
             SET name = $1, client_id = $2, color = $3, description = $4, is_disabled = $5
             WHERE id = $6
             RETURNING id, name, client_id, color, description, is_disabled`,
            [name, clientId, projectColor, description || null, isDisabled || false, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const updated = result.rows[0];

        // If project is disabled, cascade to tasks
        if (isDisabled === true) {
            await query('UPDATE tasks SET is_disabled = true WHERE project_id = $1', [id]);
        }

        res.json({
            id: updated.id,
            name: updated.name,
            clientId: updated.client_id,
            color: updated.color,
            description: updated.description,
            isDisabled: updated.is_disabled
        });
    } catch (err) {
        if (err.code === '23503') { // Foreign key violation
            return res.status(400).json({ error: 'Client not found' });
        }
        next(err);
    }
});

export default router;
