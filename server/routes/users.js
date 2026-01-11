import express from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db/index.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/users - List users
router.get('/', authenticateToken, async (req, res, next) => {
    try {
        let result;

        if (req.user.role === 'admin') {
            // Admin sees all users
            result = await query(
                'SELECT id, name, username, role, avatar_initials, is_disabled FROM users ORDER BY name'
            );
        } else if (req.user.role === 'manager') {
            // Manager sees regular users and themselves
            result = await query(
                `SELECT id, name, username, role, avatar_initials, is_disabled FROM users 
          WHERE role = 'user' OR id = $1 ORDER BY name`,
                [req.user.id]
            );
        } else {
            // Regular users only see themselves
            result = await query(
                'SELECT id, name, username, role, avatar_initials, is_disabled FROM users WHERE id = $1',
                [req.user.id]
            );
        }

        const users = result.rows.map(u => ({
            id: u.id,
            name: u.name,
            username: u.username,
            role: u.role,
            avatarInitials: u.avatar_initials,
            isDisabled: !!u.is_disabled
        }));

        res.json(users);
    } catch (err) {
        next(err);
    }
});

// POST /api/users - Create user (admin only)
router.post('/', authenticateToken, requireRole('admin'), async (req, res, next) => {
    try {
        const { name, username, password, role } = req.body;

        if (!name || !username || !password || !role) {
            return res.status(400).json({ error: 'Name, username, password, and role are required' });
        }

        if (!['admin', 'manager', 'user'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        const avatarInitials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const passwordHash = await bcrypt.hash(password, 12);
        const id = 'u-' + Date.now();

        await query(
            `INSERT INTO users (id, name, username, password_hash, role, avatar_initials, is_disabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, name, username, passwordHash, role, avatarInitials, false]
        );

        res.status(201).json({
            id,
            name,
            username,
            role,
            avatarInitials
        });
    } catch (err) {
        if (err.code === '23505') { // Unique violation
            return res.status(400).json({ error: 'Username already exists' });
        }
        next(err);
    }
});

// DELETE /api/users/:id - Delete user (admin only)
router.delete('/:id', authenticateToken, requireRole('admin'), async (req, res, next) => {
    try {
        const { id } = req.params;

        if (id === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }

        const result = await query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ message: 'User deleted' });
    } catch (err) {
        next(err);
    }
});

// PUT /api/users/:id - Update user (admin only)
router.put('/:id', authenticateToken, requireRole('admin'), async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, isDisabled } = req.body;

        if (id === req.user.id && isDisabled === true) {
            return res.status(400).json({ error: 'Cannot disable your own account' });
        }

        const updates = [];
        const values = [];
        let paramIdx = 1;

        if (name !== undefined) {
            updates.push(`name = $${paramIdx++}`);
            values.push(name);
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
            `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING id, name, username, role, avatar_initials, is_disabled`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const u = result.rows[0];
        res.json({
            id: u.id,
            name: u.name,
            username: u.username,
            role: u.role,
            avatarInitials: u.avatar_initials,
            isDisabled: !!u.is_disabled
        });
    } catch (err) {
        next(err);
    }
});

// GET /api/users/:id/assignments - Get user assignments
router.get('/:id/assignments', authenticateToken, async (req, res, next) => {
    try {
        const { id } = req.params;

        // Only admins, managers, or the user themselves can view assignments
        if (req.user.role !== 'admin' && req.user.role !== 'manager' && req.user.id !== id) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        const clientsRes = await query(
            'SELECT client_id FROM user_clients WHERE user_id = $1',
            [id]
        );
        const projectsRes = await query(
            'SELECT project_id FROM user_projects WHERE user_id = $1',
            [id]
        );
        const tasksRes = await query(
            'SELECT task_id FROM user_tasks WHERE user_id = $1',
            [id]
        );

        res.json({
            clientIds: clientsRes.rows.map(r => r.client_id),
            projectIds: projectsRes.rows.map(r => r.project_id),
            taskIds: tasksRes.rows.map(r => r.task_id)
        });
    } catch (err) {
        next(err);
    }
});

// POST /api/users/:id/assignments - Update user assignments (admin/manager only)
router.post('/:id/assignments', authenticateToken, requireRole('admin', 'manager'), async (req, res, next) => {
    try {
        const { id } = req.params;
        const { clientIds, projectIds, taskIds } = req.body;

        await query('BEGIN');

        // Update Clients
        if (clientIds) {
            await query('DELETE FROM user_clients WHERE user_id = $1', [id]);
            for (const clientId of clientIds) {
                await query(
                    'INSERT INTO user_clients (user_id, client_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [id, clientId]
                );
            }
        }

        // Update Projects
        if (projectIds) {
            await query('DELETE FROM user_projects WHERE user_id = $1', [id]);
            for (const projectId of projectIds) {
                await query(
                    'INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [id, projectId]
                );
            }
        }

        // Update Tasks
        if (taskIds) {
            await query('DELETE FROM user_tasks WHERE user_id = $1', [id]);
            for (const taskId of taskIds) {
                await query(
                    'INSERT INTO user_tasks (user_id, task_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [id, taskId]
                );
            }
        }

        await query('COMMIT');
        res.json({ message: 'Assignments updated' });
    } catch (err) {
        await query('ROLLBACK');
        next(err);
    }
});

export default router;
