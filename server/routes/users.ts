import bcrypt from 'bcryptjs';
import { query } from '../db/index.ts';
import { authenticateToken, requireRole } from '../middleware/auth.ts';
import { requireNonEmptyString, optionalNonEmptyString, validateEnum, optionalNonNegativeNumber, optionalArrayOfStrings, badRequest } from '../utils/validation.ts';

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

        const nameResult = requireNonEmptyString(name, 'name');
        if (!nameResult.ok) return badRequest(reply, nameResult.message);

        const usernameResult = requireNonEmptyString(username, 'username');
        if (!usernameResult.ok) return badRequest(reply, usernameResult.message);

        const passwordResult = requireNonEmptyString(password, 'password');
        if (!passwordResult.ok) return badRequest(reply, passwordResult.message);

        const roleResult = validateEnum(role, ['admin', 'manager', 'user'], 'role');
        if (!roleResult.ok) return badRequest(reply, roleResult.message);

        const costPerHourResult = optionalNonNegativeNumber(costPerHour, 'costPerHour');
        if (!costPerHourResult.ok) return badRequest(reply, costPerHourResult.message);

        const avatarInitials = nameResult.value.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const passwordHash = await bcrypt.hash(passwordResult.value, 12);
        const id = 'u-' + Date.now();

        try {
            await query(
                `INSERT INTO users (id, name, username, password_hash, role, avatar_initials, cost_per_hour, is_disabled)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [id, nameResult.value, usernameResult.value, passwordHash, roleResult.value, avatarInitials, costPerHourResult.value || 0, false]
            );

            return reply.code(201).send({
                id,
                name: nameResult.value,
                username: usernameResult.value,
                role: roleResult.value,
                avatarInitials
            });
        } catch (err) {
            if (err.code === '23505') { // Unique violation
                return badRequest(reply, 'Username already exists');
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
            return badRequest(reply, 'Cannot delete your own account');
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
        const idResult = requireNonEmptyString(id, 'id');
        if (!idResult.ok) return badRequest(reply, idResult.message);

        if (name !== undefined) {
            const nameResult = optionalNonEmptyString(name, 'name');
            if (!nameResult.ok) return badRequest(reply, nameResult.message);
        }

        if (costPerHour !== undefined) {
            const costPerHourResult = optionalNonNegativeNumber(costPerHour, 'costPerHour');
            if (!costPerHourResult.ok) return badRequest(reply, costPerHourResult.message);
        }

        // Managers can only edit users with role 'user'
        if (request.user.role === 'manager') {
            const userCheck = await query('SELECT role FROM users WHERE id = $1', [idResult.value]);
            if (userCheck.rows.length === 0) {
                return reply.code(404).send({ error: 'User not found' });
            }
            if (userCheck.rows[0].role !== 'user' && idResult.value !== request.user.id) {
                return reply.code(403).send({ error: 'Managers can only edit users' });
            }
        }

        if (idResult.value === request.user.id && isDisabled === true) {
            return badRequest(reply, 'Cannot disable your own account');
        }

        const updates = [];
        const values = [];
        let paramIdx = 1;

        if (name !== undefined) {
            updates.push(`name = $${paramIdx++}`);
            values.push(requireNonEmptyString(name, 'name').value);
        }

        if (isDisabled !== undefined) {
            updates.push(`is_disabled = $${paramIdx++}`);
            values.push(isDisabled);
        }

        if (costPerHour !== undefined) {
            updates.push(`cost_per_hour = $${paramIdx++}`);
            values.push(optionalNonNegativeNumber(costPerHour, 'costPerHour').value);
        }

        if (updates.length === 0) {
            return badRequest(reply, 'No fields to update');
        }

        values.push(idResult.value);
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
        const idResult = requireNonEmptyString(id, 'id');
        if (!idResult.ok) return badRequest(reply, idResult.message);

        // Only admins, managers, or the user themselves can view assignments
        if (request.user.role !== 'admin' && request.user.role !== 'manager' && request.user.id !== id) {
            return reply.code(403).send({ error: 'Insufficient permissions' });
        }

        const clientsRes = await query(
            'SELECT client_id FROM user_clients WHERE user_id = $1',
            [idResult.value]
        );
        const projectsRes = await query(
            'SELECT project_id FROM user_projects WHERE user_id = $1',
            [idResult.value]
        );
        const tasksRes = await query(
            'SELECT task_id FROM user_tasks WHERE user_id = $1',
            [idResult.value]
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
        const idResult = requireNonEmptyString(id, 'id');
        if (!idResult.ok) return badRequest(reply, idResult.message);

        if (request.user.role === 'admin' && taskIds !== undefined) {
            return reply.code(403).send({ error: 'Admins cannot assign tasks' });
        }

        const clientIdsResult = optionalArrayOfStrings(clientIds, 'clientIds');
        if (!clientIdsResult.ok) return badRequest(reply, clientIdsResult.message);

        const projectIdsResult = optionalArrayOfStrings(projectIds, 'projectIds');
        if (!projectIdsResult.ok) return badRequest(reply, projectIdsResult.message);

        const taskIdsResult = optionalArrayOfStrings(taskIds, 'taskIds');
        if (!taskIdsResult.ok) return badRequest(reply, taskIdsResult.message);

        try {
            await query('BEGIN');

            // Update Clients
            if (clientIds) {
                await query('DELETE FROM user_clients WHERE user_id = $1', [idResult.value]);
                for (const clientId of clientIdsResult.value) {
                    await query(
                        'INSERT INTO user_clients (user_id, client_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                        [idResult.value, clientId]
                    );
                }
            }

            // Update Projects
            if (projectIds) {
                await query('DELETE FROM user_projects WHERE user_id = $1', [idResult.value]);
                for (const projectId of projectIdsResult.value) {
                    await query(
                        'INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                        [idResult.value, projectId]
                    );
                }
            }

            // Update Tasks
            if (taskIds) {
                await query('DELETE FROM user_tasks WHERE user_id = $1', [idResult.value]);
                for (const taskId of taskIdsResult.value) {
                    await query(
                        'INSERT INTO user_tasks (user_id, task_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                        [idResult.value, taskId]
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
