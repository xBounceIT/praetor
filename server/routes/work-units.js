import express from 'express';
import { query } from '../db/index.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/work-units - List work units
// Admin: sees all
// Manager: sees only work units they manage
router.get('/', authenticateToken, async (req, res, next) => {
    try {
        let result;
        if (req.user.role === 'admin') {
            result = await query(`
                SELECT w.*, u.name as manager_name,
                (SELECT COUNT(*) FROM user_work_units uw WHERE uw.work_unit_id = w.id) as user_count
                FROM work_units w
                JOIN users u ON w.manager_id = u.id
                ORDER BY w.name
            `);
        } else if (req.user.role === 'manager') {
            result = await query(`
                SELECT w.*, u.name as manager_name,
                (SELECT COUNT(*) FROM user_work_units uw WHERE uw.work_unit_id = w.id) as user_count
                FROM work_units w
                JOIN users u ON w.manager_id = u.id
                WHERE w.manager_id = $1
                ORDER BY w.name
            `, [req.user.id]);
        } else {
            // Regular users don't see work units list (or maybe only their own?)
            // For now, restricting to admin/manager
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        const workUnits = result.rows.map(w => ({
            id: w.id,
            name: w.name,
            managerId: w.manager_id,
            managerName: w.manager_name,
            description: w.description,
            isDisabled: !!w.is_disabled,
            userCount: parseInt(w.user_count)
        }));

        res.json(workUnits);
    } catch (err) {
        next(err);
    }
});

// POST /api/work-units - Create work unit (Admin only)
router.post('/', authenticateToken, requireRole('admin'), async (req, res, next) => {
    try {
        const { name, managerId, description } = req.body;

        if (!name || !managerId) {
            return res.status(400).json({ error: 'Name and Manager are required' });
        }

        // Verify manager exists and is a manager or admin
        const managerCheck = await query('SELECT role FROM users WHERE id = $1', [managerId]);
        if (managerCheck.rows.length === 0) {
            return res.status(400).json({ error: 'Manager user not found' });
        }

        const id = 'wu-' + Date.now();
        await query(
            'INSERT INTO work_units (id, name, manager_id, description) VALUES ($1, $2, $3, $4)',
            [id, name, managerId, description]
        );

        // Fetch created unit with manager name
        const result = await query(`
            SELECT w.*, u.name as manager_name
            FROM work_units w
            JOIN users u ON w.manager_id = u.id
            WHERE w.id = $1
        `, [id]);

        const w = result.rows[0];
        res.status(201).json({
            id: w.id,
            name: w.name,
            managerId: w.manager_id,
            managerName: w.manager_name,
            description: w.description,
            isDisabled: !!w.is_disabled,
            userCount: 0
        });
    } catch (err) {
        next(err);
    }
});

// PUT /api/work-units/:id - Update work unit (Admin only)
router.put('/:id', authenticateToken, requireRole('admin'), async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, managerId, description, isDisabled } = req.body;

        const updates = [];
        const values = [];
        let paramIdx = 1;

        if (name !== undefined) {
            updates.push(`name = $${paramIdx++}`);
            values.push(name);
        }
        if (managerId !== undefined) {
            // Verify manager exists
            const managerCheck = await query('SELECT 1 FROM users WHERE id = $1', [managerId]);
            if (managerCheck.rows.length === 0) {
                return res.status(400).json({ error: 'Manager user not found' });
            }
            updates.push(`manager_id = $${paramIdx++}`);
            values.push(managerId);
        }
        if (description !== undefined) {
            updates.push(`description = $${paramIdx++}`);
            values.push(description);
        }
        if (isDisabled !== undefined) {
            updates.push(`is_disabled = $${paramIdx++}`);
            values.push(isDisabled);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        values.push(id);
        const result = await query(
            `UPDATE work_units SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Work unit not found' });
        }

        // Fetch updated unit with extra details
        const details = await query(`
            SELECT w.*, u.name as manager_name,
            (SELECT COUNT(*) FROM user_work_units uw WHERE uw.work_unit_id = w.id) as user_count
            FROM work_units w
            JOIN users u ON w.manager_id = u.id
            WHERE w.id = $1
        `, [id]);

        const w = details.rows[0];
        res.json({
            id: w.id,
            name: w.name,
            managerId: w.manager_id,
            managerName: w.manager_name,
            description: w.description,
            isDisabled: !!w.is_disabled,
            userCount: parseInt(w.user_count)
        });
    } catch (err) {
        next(err);
    }
});

// DELETE /api/work-units/:id - Delete work unit (Admin only)
router.delete('/:id', authenticateToken, requireRole('admin'), async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await query('DELETE FROM work_units WHERE id = $1 RETURNING id', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Work unit not found' });
        }

        res.json({ message: 'Work unit deleted' });
    } catch (err) {
        next(err);
    }
});

// GET /api/work-units/:id/users - Get users in work unit (Admin or Manager of that unit)
router.get('/:id/users', authenticateToken, async (req, res, next) => {
    try {
        const { id } = req.params;

        // Check permissions
        if (req.user.role !== 'admin') {
            const unit = await query('SELECT manager_id FROM work_units WHERE id = $1', [id]);
            if (unit.rows.length === 0) return res.status(404).json({ error: 'Work unit not found' });
            if (unit.rows[0].manager_id !== req.user.id) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        const result = await query(`
            SELECT u.id 
            FROM user_work_units uw
            JOIN users u ON uw.user_id = u.id
            WHERE uw.work_unit_id = $1
        `, [id]);

        res.json(result.rows.map(r => r.id));
    } catch (err) {
        next(err);
    }
});

// POST /api/work-units/:id/users - Update users in work unit (Admin only)
router.post('/:id/users', authenticateToken, requireRole('admin'), async (req, res, next) => {
    try {
        const { id } = req.params;
        const { userIds } = req.body; // Array of user IDs

        if (!Array.isArray(userIds)) {
            return res.status(400).json({ error: 'userIds must be an array' });
        }

        await query('BEGIN');

        // Remove existing users from this unit
        await query('DELETE FROM user_work_units WHERE work_unit_id = $1', [id]);

        // Add new users
        for (const userId of userIds) {
            await query(
                'INSERT INTO user_work_units (user_id, work_unit_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [userId, id]
            );
        }

        await query('COMMIT');
        res.json({ message: 'Work unit users updated' });
    } catch (err) {
        await query('ROLLBACK');
        next(err);
    }
});

export default router;
