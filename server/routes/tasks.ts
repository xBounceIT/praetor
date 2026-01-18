import { query } from '../db/index.ts';
import { authenticateToken } from '../middleware/auth.ts';
import { requireNonEmptyString, optionalNonEmptyString, parseDateString, optionalNonNegativeNumber, requireNonEmptyArrayOfStrings, parseBoolean, optionalDateString, badRequest } from '../utils/validation.ts';

export default async function (fastify, opts) {
    // GET / - List all tasks
    fastify.get('/', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        let queryText = `
            SELECT id, name, project_id, description, is_recurring, 
                   recurrence_pattern, recurrence_start, recurrence_end, recurrence_duration, is_disabled 
            FROM tasks ORDER BY name
        `;
        let queryParams = [];

        if (request.user.role === 'user') {
            queryText = `
                SELECT t.id, t.name, t.project_id, t.description, t.is_recurring, 
                       t.recurrence_pattern, t.recurrence_start, t.recurrence_end, t.recurrence_duration, t.is_disabled 
                FROM tasks t
                INNER JOIN user_tasks ut ON t.id = ut.task_id
                WHERE ut.user_id = $1
                ORDER BY t.name
            `;
            queryParams = [request.user.id];
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
            recurrenceDuration: parseFloat(t.recurrence_duration || 0),
            isDisabled: t.is_disabled
        }));

        return tasks;
    });

    // POST / - Create task
    fastify.post('/', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        const { name, projectId, description, isRecurring, recurrencePattern, recurrenceStart } = request.body;

        const nameResult = requireNonEmptyString(name, 'name');
        if (!nameResult.ok) return badRequest(reply, nameResult.message);

        const projectIdResult = requireNonEmptyString(projectId, 'projectId');
        if (!projectIdResult.ok) return badRequest(reply, projectIdResult.message);

        const durationResult = optionalNonNegativeNumber(request.body.recurrenceDuration, 'recurrenceDuration');
        if (!durationResult.ok) return badRequest(reply, durationResult.message);

        const isRecurringValue = parseBoolean(isRecurring);
        let start = null;
        if (isRecurringValue) {
            const recurrenceStartResult = optionalDateString(recurrenceStart, 'recurrenceStart');
            if (!recurrenceStartResult.ok) return badRequest(reply, recurrenceStartResult.message);
            start = recurrenceStartResult.value || new Date().toISOString().split('T')[0];
        }

        const id = 't-' + Date.now();

        try {
            await query(
                `INSERT INTO tasks (id, name, project_id, description, is_recurring, recurrence_pattern, recurrence_start, recurrence_duration, is_disabled) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [id, nameResult.value, projectIdResult.value, description || null, isRecurringValue, recurrencePattern || null, start, durationResult.value || 0, false]
            );

            return reply.code(201).send({
                id,
                name: nameResult.value,
                projectId: projectIdResult.value,
                description,
                isRecurring: isRecurringValue,
                recurrencePattern,
                recurrenceStart: start,
                recurrenceDuration: durationResult.value || 0,
                isDisabled: false
            });
        } catch (err) {
            if (err.code === '23503') { // Foreign key violation
                return reply.code(400).send({ error: 'Project not found' });
            }
            throw err;
        }
    });

    // PUT /:id - Update task
    fastify.put('/:id', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        const { id } = request.params;
        const idResult = requireNonEmptyString(id, 'id');
        if (!idResult.ok) return badRequest(reply, idResult.message);
        const { name, description, isRecurring, recurrencePattern, recurrenceStart, recurrenceEnd, isDisabled } = request.body;
        const result = await query('SELECT user_id FROM user_tasks WHERE task_id = $1', [idResult.value]);
        const result = await query('SELECT user_id FROM user_tasks WHERE task_id = $1', [idResult.value]);
        if (!idResult.ok) return badRequest(reply, idResult.message);
        const result = await query('DELETE FROM tasks WHERE id = $1 RETURNING id', [idResult.value]);
        const durationResult = optionalNonNegativeNumber(request.body.recurrenceDuration, 'recurrenceDuration');
        if (!durationResult.ok) return badRequest(reply, durationResult.message);

        if (recurrenceStart !== undefined && recurrenceStart !== null && recurrenceStart !== '') {
            const startResult = parseDateString(recurrenceStart, 'recurrenceStart');
            if (!startResult.ok) return badRequest(reply, startResult.message);
        const idResult = requireNonEmptyString(id, 'id');
        if (!idResult.ok) return badRequest(reply, idResult.message);
        const userIdsResult = requireNonEmptyArrayOfStrings(userIds, 'userIds');
        if (!userIdsResult.ok) return badRequest(reply, userIdsResult.message);
        }

        if (recurrenceEnd !== undefined && recurrenceEnd !== null && recurrenceEnd !== '') {
            const endResult = parseDateString(recurrenceEnd, 'recurrenceEnd');
            if (!endResult.ok) return badRequest(reply, endResult.message);
        }

        const result = await query(
            `UPDATE tasks 
       SET name = COALESCE($2, name),
           description = COALESCE($3, description),
            await query('DELETE FROM user_tasks WHERE task_id = $1', [idResult.value]);
           is_recurring = COALESCE($4, is_recurring),
           recurrence_pattern = $5,
           recurrence_start = $6,
            for (const userId of userIdsResult.value) {
           recurrence_end = $7,
           recurrence_duration = $8,
                    [userId, idResult.value]
       WHERE id = $1
       RETURNING *`,
            [idResult.value, name, description, isRecurring, recurrencePattern || null, recurrenceStart || null, recurrenceEnd || null, durationResult.value || 0, isDisabled]
            [id, name, description, isRecurring, recurrencePattern || null, recurrenceStart || null, recurrenceEnd || null, request.body.recurrenceDuration || 0, isDisabled]
        );

        if (result.rows.length === 0) {
            return reply.code(404).send({ error: 'Task not found' });
        }

        const t = result.rows[0];
        return {
            id: t.id,
            name: t.name,
            projectId: t.project_id,
            description: t.description,
            isRecurring: t.is_recurring,
            recurrencePattern: t.recurrence_pattern,
            recurrenceStart: t.recurrence_start ? t.recurrence_start.toISOString().split('T')[0] : undefined,
            recurrenceEnd: t.recurrence_end ? t.recurrence_end.toISOString().split('T')[0] : undefined,
            recurrenceDuration: parseFloat(t.recurrence_duration || 0),
            isDisabled: t.is_disabled
        };
    });

    // DELETE /:id - Delete task
    fastify.delete('/:id', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        const { id } = request.params;
        const idResult = requireNonEmptyString(id, 'id');
        if (!idResult.ok) return badRequest(reply, idResult.message);
        const result = await query('DELETE FROM tasks WHERE id = $1 RETURNING id', [id]);

        const result = await query('DELETE FROM tasks WHERE id = $1 RETURNING id', [idResult.value]);
        if (result.rows.length === 0) {
            return reply.code(404).send({ error: 'Task not found' });
        }

        return { message: 'Task deleted' };
    });

    // GET /:id/users - Get assigned users
    fastify.get('/:id/users', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        const { id } = request.params;
        const result = await query('SELECT user_id FROM user_tasks WHERE task_id = $1', [id]);
        return result.rows.map(r => r.user_id);
    });

    // POST /:id/users - Update assigned users
    fastify.post('/:id/users', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        const { id } = request.params;
        const { userIds } = request.body;

        // Only admin/manager can assign users
        if (request.user.role !== 'admin' && request.user.role !== 'manager') {
            return reply.code(403).send({ error: 'Insufficient permissions' });
        }

        try {
            await query('BEGIN');

            // Delete existing assignments
            await query('DELETE FROM user_tasks WHERE task_id = $1', [id]);

            // Insert new ones
            for (const userId of userIds) {
                await query(
                    'INSERT INTO user_tasks (user_id, task_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [userId, id]
                );
            }

            await query('COMMIT');
            return { message: 'Task assignments updated' };
        } catch (err) {
            await query('ROLLBACK');
            throw err;
        }
    });
}
