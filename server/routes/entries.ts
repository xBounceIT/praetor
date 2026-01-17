import { query } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

export default async function (fastify, opts) {
    // GET / - List time entries
    fastify.get('/', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        let result;

        if (request.user.role === 'admin' || request.user.role === 'manager') {
            // Admins and managers can see all entries, optionally filtered by user
            const { userId } = request.query;
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
                [request.user.id]
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

        return entries;
    });

    // POST / - Create time entry
    fastify.post('/', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        const { date, clientId, clientName, projectId, projectName, task, notes, duration, isPlaceholder, userId } = request.body;

        if (!date || !clientId || !clientName || !projectId || !projectName || !task) {
            return reply.code(400).send({ error: 'Missing required fields' });
        }

        // Allow admins/managers to create entries for other users
        let targetUserId = request.user.id;
        if (userId && (request.user.role === 'admin' || request.user.role === 'manager')) {
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

        return reply.code(201).send({
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
    });

    // PUT /:id - Update time entry
    fastify.put('/:id', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        const { id } = request.params;
        const { duration, notes, isPlaceholder } = request.body;

        // Check ownership or admin/manager role
        const existing = await query('SELECT user_id FROM time_entries WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return reply.code(404).send({ error: 'Entry not found' });
        }

        if (existing.rows[0].user_id !== request.user.id && request.user.role === 'user') {
            return reply.code(403).send({ error: 'Not authorized to update this entry' });
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
        return {
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
        };
    });

    // DELETE /:id - Delete time entry
    fastify.delete('/:id', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        const { id } = request.params;

        // Check ownership or admin/manager role
        const existing = await query('SELECT user_id FROM time_entries WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return reply.code(404).send({ error: 'Entry not found' });
        }

        if (existing.rows[0].user_id !== request.user.id && request.user.role === 'user') {
            return reply.code(403).send({ error: 'Not authorized to delete this entry' });
        }

        await query('DELETE FROM time_entries WHERE id = $1', [id]);
        return { message: 'Entry deleted' };
    });

    // DELETE / - Bulk delete entries (for recurring cleanup)
    fastify.delete('/', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        const { projectId, task, futureOnly, placeholderOnly } = request.query;

        if (!projectId || !task) {
            return reply.code(400).send({ error: 'projectId and task are required' });
        }

        let sql = 'DELETE FROM time_entries WHERE project_id = $1 AND task = $2';
        const params = [projectId, task];
        let paramIndex = 3;

        // Only delete user's own entries unless admin/manager
        if (request.user.role === 'user') {
            sql += ` AND user_id = $${paramIndex++}`;
            params.push(request.user.id);
        }

        if (futureOnly === 'true') {
            sql += ` AND date >= $${paramIndex++}`;
            params.push(new Date().toISOString().split('T')[0]);
        }

        if (placeholderOnly === 'true') {
            sql += ' AND is_placeholder = true';
        }

        const result = await query(sql + ' RETURNING id', params);
        return { message: `Deleted ${result.rows.length} entries` };
    });
}
