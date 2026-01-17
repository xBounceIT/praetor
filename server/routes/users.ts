import bcrypt from 'bcryptjs';
import { query } from '../db/index.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

export default async function (fastify, opts) {
    // GET / - List users
    fastify.get('/', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        let result;

        if (request.user.role === 'admin') {
            // Admin sees all users
            result = await query(
                'SELECT id, name, username, role, avatar_initials, cost_per_hour, is_disabled FROM users ORDER BY name'
            );
        } else if (request.user.role === 'manager') {
            // Manager sees themselves AND users in work units they manage
            result = await query(
                `SELECT DISTINCT u.id, u.name, u.username, u.role, u.avatar_initials, u.cost_per_hour, u.is_disabled
                 FROM users u
                 LEFT JOIN user_work_units uw ON u.id = uw.user_id
                 LEFT JOIN work_unit_managers wum ON uw.work_unit_id = wum.work_unit_id
                 WHERE u.id = $1  -- The manager themselves
                    OR wum.user_id = $1 -- Users in work units managed by this user
                 ORDER BY u.name`,
                [request.user.id]
            );
        } else {
            // Regular users only see themselves
            result = await query(
                'SELECT id, name, username, role, avatar_initials, is_disabled FROM users WHERE id = $1',
                [request.user.id]
            );
        }

        const users = result.rows.map(u => ({
            id: u.id,
            name: u.name,
            username: u.username,
            role: u.role,
            avatarInitials: u.avatar_initials,
            costPerHour: parseFloat(u.cost_per_hour || 0),
            isDisabled: !!u.is_disabled
        }));

        return users;
    });

    // POST / - Create user (admin only)
    fastify.post('/', {
        onRequest: [authenticateToken, requireRole('admin')]
    }, async (request, reply) => {
        const { name, username, password, role, costPerHour } = request.body;

        if (!name || !username || !password || !role) {
            return reply.code(400).send({ error: 'Name, username, password, and role are required' });
        }

        if (!['admin', 'manager', 'user'].includes(role)) {
            return reply.code(400).send({ error: 'Invalid role' });
        }

        const avatarInitials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const passwordHash = await bcrypt.hash(password, 12);
        const id = 'u-' + Date.now();

        try {
            await query(
                `INSERT INTO users (id, name, username, password_hash, role, avatar_initials, cost_per_hour, is_disabled)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [id, name, username, passwordHash, role, avatarInitials, costPerHour || 0, false]
            );

            return reply.code(201).send({
                id,
                name,
                username,
                role,
                avatarInitials
            });
        } catch (err) {
            if (err.code === '23505') { // Unique violation
                return reply.code(400).send({ error: 'Username already exists' });
            }
            throw err;
        }
    });

    // DELETE /:id - Delete user (admin only)
    fastify.delete('/:id', {
        onRequest: [authenticateToken, requireRole('admin')]
    }, async (request, reply) => {
        const { id } = request.params;

        if (id === request.user.id) {
            return reply.code(400).send({ error: 'Cannot delete your own account' });
        }

        const result = await query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);

        if (result.rows.length === 0) {
            return reply.code(404).send({ error: 'User not found' });
        }

        return { message: 'User deleted' };
    });

    // PUT /:id - Update user (admin and manager)
    fastify.put('/:id', {
        onRequest: [authenticateToken, requireRole('admin', 'manager')]
    }, async (request, reply) => {
        const { id } = request.params;
        const { name, isDisabled, costPerHour } = request.body;

        // Managers can only edit users with role 'user'
        if (request.user.role === 'manager') {
            const userCheck = await query('SELECT role FROM users WHERE id = $1', [id]);
            if (userCheck.rows.length === 0) {
                return reply.code(404).send({ error: 'User not found' });
            }
            if (userCheck.rows[0].role !== 'user' && id !== request.user.id) {
                return reply.code(403).send({ error: 'Managers can only edit users' });
            }
        }

        if (id === request.user.id && isDisabled === true) {
            return reply.code(400).send({ error: 'Cannot disable your own account' });
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

        if (costPerHour !== undefined) {
            updates.push(`cost_per_hour = $${paramIdx++}`);
            values.push(costPerHour);
        }

        if (updates.length === 0) {
            return reply.code(400).send({ error: 'No fields to update' });
        }

        values.push(id);
        const result = await query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING id, name, username, role, avatar_initials, cost_per_hour, is_disabled`,
            values
        );

        if (result.rows.length === 0) {
            return reply.code(404).send({ error: 'User not found' });
        }

        const u = result.rows[0];
        return {
            id: u.id,
            name: u.name,
            username: u.username,
            role: u.role,
            avatarInitials: u.avatar_initials,
            costPerHour: parseFloat(u.cost_per_hour || 0),
            isDisabled: !!u.is_disabled
        };
    });

    // GET /:id/assignments - Get user assignments
    fastify.get('/:id/assignments', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        const { id } = request.params;

        // Only admins, managers, or the user themselves can view assignments
        if (request.user.role !== 'admin' && request.user.role !== 'manager' && request.user.id !== id) {
            return reply.code(403).send({ error: 'Insufficient permissions' });
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

        return {
            clientIds: clientsRes.rows.map(r => r.client_id),
            projectIds: projectsRes.rows.map(r => r.project_id),
            taskIds: tasksRes.rows.map(r => r.task_id)
        };
    });

    // POST /:id/assignments - Update user assignments (admin/manager only)
    fastify.post('/:id/assignments', {
        onRequest: [authenticateToken, requireRole('admin', 'manager')]
    }, async (request, reply) => {
        const { id } = request.params;
        const { clientIds, projectIds, taskIds } = request.body;

        try {
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
            return { message: 'Assignments updated' };
        } catch (err) {
            await query('ROLLBACK');
            throw err;
        }
    });
}
