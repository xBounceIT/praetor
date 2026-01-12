import express from 'express';
import { query } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// GET /api/entries - List time entries
router.get('/', authenticateToken, async (req, res, next) => {
    try {
        let result;

        if (req.user.role === 'admin' || req.user.role === 'manager') {
            // Admins and managers can see all entries, optionally filtered by user
            const { userId } = req.query;
            if (userId) {
                result = await query(
                    `SELECT id, user_id, date, client_id, client_name, project_id, 
                  project_name, task, notes, duration, hourly_cost, is_placeholder, created_at
           FROM time_entries WHERE user_id = $1 ORDER BY created_at DESC`,
                    [userId]
                );
            } else {
                result = await query(
                    `SELECT id, user_id, date, client_id, client_name, project_id, 
                  project_name, task, notes, duration, hourly_cost, is_placeholder, created_at
           FROM time_entries ORDER BY created_at DESC`
                );
            }
        } else {
            // Regular users can only see their own entries
            result = await query(
                `SELECT id, user_id, date, client_id, client_name, project_id, 
                project_name, task, notes, duration, hourly_cost, is_placeholder, created_at
         FROM time_entries WHERE user_id = $1 ORDER BY created_at DESC`,
                [req.user.id]
            );
        }

        const entries = result.rows.map(e => ({
            id: e.id,
            userId: e.user_id,
            date: e.date.toISOString().split('T')[0],
            clientId: e.client_id,
            clientName: e.client_name,
            projectId: e.project_id,
            projectName: e.project_name,
            task: e.task,
            notes: e.notes,
            duration: parseFloat(e.duration),
            hourlyCost: parseFloat(e.hourly_cost || 0),
            isPlaceholder: e.is_placeholder,
            createdAt: new Date(e.created_at).getTime()
        }));

        res.json(entries);
    } catch (err) {
        next(err);
    }
});

// POST /api/entries - Create time entry
router.post('/', authenticateToken, async (req, res, next) => {
    try {
        const { date, clientId, clientName, projectId, projectName, task, notes, duration, isPlaceholder, userId } = req.body;

        if (!date || !clientId || !clientName || !projectId || !projectName || !task) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Allow admins/managers to create entries for other users
        let targetUserId = req.user.id;
        if (userId && (req.user.role === 'admin' || req.user.role === 'manager')) {
            targetUserId = userId;
        }

        // Fetch user's current cost
        const userResult = await query('SELECT cost_per_hour FROM users WHERE id = $1', [targetUserId]);
        const hourlyCost = userResult.rows[0]?.cost_per_hour || 0;

        const id = Math.random().toString(36).substr(2, 9);

        await query(
            `INSERT INTO time_entries (id, user_id, date, client_id, client_name, project_id, project_name, task, notes, duration, hourly_cost, is_placeholder)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [id, targetUserId, date, clientId, clientName, projectId, projectName, task, notes || null, duration || 0, hourlyCost, isPlaceholder || false]
        );

        res.status(201).json({
            id,
            userId: targetUserId,
            date,
            clientId,
            clientName,
            projectId,
            projectName,
            task,
            notes,
            duration: duration || 0,
            hourlyCost: parseFloat(hourlyCost),
            isPlaceholder: isPlaceholder || false,
            createdAt: Date.now()
        });
    } catch (err) {
        next(err);
    }
});

// PUT /api/entries/:id - Update time entry
router.put('/:id', authenticateToken, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { duration, notes, isPlaceholder } = req.body;

        // Check ownership or admin/manager role
        const existing = await query('SELECT user_id FROM time_entries WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Entry not found' });
        }

        if (existing.rows[0].user_id !== req.user.id && req.user.role === 'user') {
            return res.status(403).json({ error: 'Not authorized to update this entry' });
        }

        const result = await query(
            `UPDATE time_entries 
       SET duration = COALESCE($2, duration),
           notes = COALESCE($3, notes),
           is_placeholder = COALESCE($4, is_placeholder)
       WHERE id = $1
       RETURNING *`,
            [id, duration, notes, isPlaceholder]
        );

        const e = result.rows[0];
        res.json({
            id: e.id,
            userId: e.user_id,
            date: e.date.toISOString().split('T')[0],
            clientId: e.client_id,
            clientName: e.client_name,
            projectId: e.project_id,
            projectName: e.project_name,
            task: e.task,
            notes: e.notes,
            duration: parseFloat(e.duration),
            hourlyCost: parseFloat(e.hourly_cost || 0),
            isPlaceholder: e.is_placeholder,
            createdAt: new Date(e.created_at).getTime()
        });
    } catch (err) {
        next(err);
    }
});

// DELETE /api/entries/:id - Delete time entry
router.delete('/:id', authenticateToken, async (req, res, next) => {
    try {
        const { id } = req.params;

        // Check ownership or admin/manager role
        const existing = await query('SELECT user_id FROM time_entries WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Entry not found' });
        }

        if (existing.rows[0].user_id !== req.user.id && req.user.role === 'user') {
            return res.status(403).json({ error: 'Not authorized to delete this entry' });
        }

        await query('DELETE FROM time_entries WHERE id = $1', [id]);
        res.json({ message: 'Entry deleted' });
    } catch (err) {
        next(err);
    }
});

// DELETE /api/entries - Bulk delete entries (for recurring cleanup)
router.delete('/', authenticateToken, async (req, res, next) => {
    try {
        const { projectId, task, futureOnly, placeholderOnly } = req.query;

        if (!projectId || !task) {
            return res.status(400).json({ error: 'projectId and task are required' });
        }

        let sql = 'DELETE FROM time_entries WHERE project_id = $1 AND task = $2';
        const params = [projectId, task];
        let paramIndex = 3;

        // Only delete user's own entries unless admin/manager
        if (req.user.role === 'user') {
            sql += ` AND user_id = $${paramIndex++}`;
            params.push(req.user.id);
        }

        if (futureOnly === 'true') {
            sql += ` AND date >= $${paramIndex++}`;
            params.push(new Date().toISOString().split('T')[0]);
        }

        if (placeholderOnly === 'true') {
            sql += ' AND is_placeholder = true';
        }

        const result = await query(sql + ' RETURNING id', params);
        res.json({ message: `Deleted ${result.rows.length} entries` });
    } catch (err) {
        next(err);
    }
});

export default router;
