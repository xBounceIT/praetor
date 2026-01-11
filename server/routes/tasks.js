import express from 'express';
import { query } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// GET /api/tasks - List all tasks
router.get('/', authenticateToken, async (req, res, next) => {
    try {
        let queryText = `
            SELECT id, name, project_id, description, is_recurring, 
                   recurrence_pattern, recurrence_start, recurrence_end, is_disabled 
            FROM tasks ORDER BY name
        `;
        let queryParams = [];

        if (req.user.role === 'user') {
            queryText = `
                SELECT t.id, t.name, t.project_id, t.description, t.is_recurring, 
                       t.recurrence_pattern, t.recurrence_start, t.recurrence_end, t.is_disabled 
                FROM tasks t
                INNER JOIN user_tasks ut ON t.id = ut.task_id
                WHERE ut.user_id = $1
                ORDER BY t.name
            `;
            queryParams = [req.user.id];
        }

        const result = await query(queryText, queryParams);

        const tasks = result.rows.map(t => ({
            id: t.id,
            name: t.name,
            projectId: t.project_id,
            description: t.description,
            isRecurring: t.is_recurring,
            recurrencePattern: t.recurrence_pattern,
            recurrenceStart: t.recurrence_start ? t.recurrence_start.toISOString().split('T')[0] : undefined,
            recurrenceEnd: t.recurrence_end ? t.recurrence_end.toISOString().split('T')[0] : undefined,
            isDisabled: t.is_disabled
        }));

        res.json(tasks);
    } catch (err) {
        next(err);
    }
});

// POST /api/tasks - Create task
router.post('/', authenticateToken, async (req, res, next) => {
    try {
        const { name, projectId, description, isRecurring, recurrencePattern } = req.body;

        if (!name || !projectId) {
            return res.status(400).json({ error: 'Task name and project ID are required' });
        }

        const id = 't-' + Date.now();
        const recurrenceStart = isRecurring ? new Date().toISOString().split('T')[0] : null;

        await query(
            `INSERT INTO tasks (id, name, project_id, description, is_recurring, recurrence_pattern, recurrence_start, is_disabled) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [id, name, projectId, description || null, isRecurring || false, recurrencePattern || null, recurrenceStart, false]
        );

        res.status(201).json({
            id,
            name,
            projectId,
            description,
            isRecurring: isRecurring || false,
            recurrencePattern,
            recurrenceStart,
            isDisabled: false
        });
    } catch (err) {
        if (err.code === '23503') { // Foreign key violation
            return res.status(400).json({ error: 'Project not found' });
        }
        next(err);
    }
});

// PUT /api/tasks/:id - Update task
router.put('/:id', authenticateToken, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, description, isRecurring, recurrencePattern, recurrenceStart, recurrenceEnd, isDisabled } = req.body;

        const result = await query(
            `UPDATE tasks 
       SET name = COALESCE($2, name),
           description = COALESCE($3, description),
           is_recurring = COALESCE($4, is_recurring),
           recurrence_pattern = $5,
           recurrence_start = $6,
           recurrence_end = $7,
           is_disabled = COALESCE($8, is_disabled)
       WHERE id = $1
       RETURNING *`,
            [id, name, description, isRecurring, recurrencePattern || null, recurrenceStart || null, recurrenceEnd || null, isDisabled]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const t = result.rows[0];
        res.json({
            id: t.id,
            name: t.name,
            projectId: t.project_id,
            description: t.description,
            isRecurring: t.is_recurring,
            recurrencePattern: t.recurrence_pattern,
            recurrenceStart: t.recurrence_start ? t.recurrence_start.toISOString().split('T')[0] : undefined,
            recurrenceEnd: t.recurrence_end ? t.recurrence_end.toISOString().split('T')[0] : undefined,
            isDisabled: t.is_disabled
        });
    } catch (err) {
        next(err);
    }
});

// DELETE /api/tasks/:id - Delete task
router.delete('/:id', authenticateToken, async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await query('DELETE FROM tasks WHERE id = $1 RETURNING id', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Task not found' });
        }

        res.json({ message: 'Task deleted' });
    } catch (err) {
        next(err);
    }
});

export default router;
