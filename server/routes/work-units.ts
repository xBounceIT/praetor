import { query } from '../db/index.ts';
import { authenticateToken, requireRole } from '../middleware/auth.ts';
import { requireNonEmptyString, requireNonEmptyArrayOfStrings, optionalNonEmptyString, optionalArrayOfStrings, badRequest } from '../utils/validation.ts';

// Helper to fetch unit with managers and user count
const fetchUnitDetails = async (unitId) => {
    const result = await query(`
        SELECT w.*,
            (
                SELECT COALESCE(json_agg(json_build_object('id', u.id, 'name', u.name)), '[]')
                FROM work_unit_managers wum
                JOIN users u ON wum.user_id = u.id
                WHERE wum.work_unit_id = w.id
            ) as managers,
            (SELECT COUNT(*) FROM user_work_units uw WHERE uw.work_unit_id = w.id) as user_count
        FROM work_units w
        WHERE w.id = $1
    `, [unitId]);
    return result.rows[0];
};

export default async function (fastify, opts) {
    // GET / - List work units
    fastify.get('/', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        let result;
        if (request.user.role === 'admin') {
            result = await query(`
                SELECT w.*,
                    (
                        SELECT COALESCE(json_agg(json_build_object('id', u.id, 'name', u.name)), '[]')
                        FROM work_unit_managers wum
                        JOIN users u ON wum.user_id = u.id
                        WHERE wum.work_unit_id = w.id
                    ) as managers,
                    (SELECT COUNT(*) FROM user_work_units uw WHERE uw.work_unit_id = w.id) as user_count
                FROM work_units w
                ORDER BY w.name
            `);
        } else if (request.user.role === 'manager') {
            result = await query(`
                SELECT w.*,
                    (
                        SELECT COALESCE(json_agg(json_build_object('id', u.id, 'name', u.name)), '[]')
                        FROM work_unit_managers wum
                        JOIN users u ON wum.user_id = u.id
                        WHERE wum.work_unit_id = w.id
                    ) as managers,
                    (SELECT COUNT(*) FROM user_work_units uw WHERE uw.work_unit_id = w.id) as user_count
                FROM work_units w
                WHERE EXISTS (
                    SELECT 1 FROM work_unit_managers wum 
                    WHERE wum.work_unit_id = w.id AND wum.user_id = $1
                )
                ORDER BY w.name
            `, [request.user.id]);
        } else {
            return reply.code(403).send({ error: 'Insufficient permissions' });
        }

        const workUnits = result.rows.map(w => ({
        const idResult = requireNonEmptyString(id, 'id');
        if (!idResult.ok) return badRequest(reply, idResult.message);
            id: w.id,
        if (name !== undefined) {
            const nameResult = optionalNonEmptyString(name, 'name');
            if (!nameResult.ok) return badRequest(reply, nameResult.message);
        }

        if (managerIds !== undefined) {
            const managerIdsResult = optionalArrayOfStrings(managerIds, 'managerIds');
            if (!managerIdsResult.ok) return badRequest(reply, managerIdsResult.message);
        }
            name: w.name,
            managers: w.managers,
            description: w.description,
            isDisabled: !!w.is_disabled,
            userCount: parseInt(w.user_count)
        }));

        return workUnits;
    });

    // POST / - Create work unit (Admin only)
    fastify.post('/', {
                    values.push(optionalNonEmptyString(name, 'name').value);
    }, async (request, reply) => {
        const { name, managerIds, description } = request.body;

        if (!name) {
            const nameResult = requireNonEmptyString(name, 'name');
            if (!nameResult.ok) return badRequest(reply, nameResult.message);
        }

        const managerIdsResult = requireNonEmptyArrayOfStrings(managerIds, 'managerIds');
        if (!managerIdsResult.ok) return badRequest(reply, managerIdsResult.message);

        try {
            await query('BEGIN');

            const id = 'wu-' + Date.now();
            await query(
                'INSERT INTO work_units (id, name, description) VALUES ($1, $2, $3)',
                [id, nameResult.value, description]
            );

            for (const managerId of managerIdsResult.value) {
                await query(
                    'INSERT INTO work_unit_managers (work_unit_id, user_id) VALUES ($1, $2)',
                    [id, managerId]
                );
                // Also add as member
                await query(
                    'INSERT INTO user_work_units (user_id, work_unit_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [managerId, id]
                );
            }

            await query('COMMIT');

            const w = await fetchUnitDetails(id);
            return reply.code(201).send({
                id: w.id,
                name: w.name,
                managers: w.managers,
                description: w.description,
                isDisabled: !!w.is_disabled,
                userCount: 0
            });
        } catch (err) {
            await query('ROLLBACK');
            throw err;
        }
    });

    // PUT /:id - Update work unit (Admin only)
    fastify.put('/:id', {
        onRequest: [authenticateToken, requireRole('admin')]
    }, async (request, reply) => {
        const { id } = request.params;
        const { name, managerIds, description, isDisabled } = request.body;

        try {
            await query('BEGIN');

            // Update basic fields
            if (name !== undefined || description !== undefined || isDisabled !== undefined) {
                const updates = [];
                const values = [];
                let paramIdx = 1;

                if (name !== undefined) {
                    updates.push(`name = $${paramIdx++}`);
                    values.push(name);
                }
                if (description !== undefined) {
                    updates.push(`description = $${paramIdx++}`);
                    values.push(description);
                }
                if (isDisabled !== undefined) {
                    updates.push(`is_disabled = $${paramIdx++}`);
                    values.push(isDisabled);
                }

                if (updates.length > 0) {
                    values.push(idResult.value);
                    const result = await query(
                        `UPDATE work_units SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING id`,
                        values
                    );
                    if (result.rows.length === 0) {
                        await query('ROLLBACK');
                        return reply.code(404).send({ error: 'Work unit not found' });
                    }
                }
            }

            // Update managers if provided
            if (managerIds !== undefined) {

                // Delete existing managers
                await query('DELETE FROM work_unit_managers WHERE work_unit_id = $1', [idResult.value]);

                // Insert new managers
                for (const managerId of optionalArrayOfStrings(managerIds, 'managerIds').value) {
                    await query(
                        'INSERT INTO work_unit_managers (work_unit_id, user_id) VALUES ($1, $2)',
                        [id, managerId]
                    );
                    // Also add as member
                    await query(
                        'INSERT INTO user_work_units (user_id, work_unit_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                        [managerId, id]
                    );
                }
            }

            await query('COMMIT');

            const w = await fetchUnitDetails(id);
            if (!w) return reply.code(404).send({ error: 'Work unit not found' });

            return {
                id: w.id,
                name: w.name,
                managers: w.managers,
                description: w.description,
                isDisabled: !!w.is_disabled,
                userCount: parseInt(w.user_count)
            };
        } catch (err) {
            await query('ROLLBACK');
            throw err;
        }
    });

    // DELETE /:id - Delete work unit (Admin only)
    fastify.delete('/:id', {
        onRequest: [authenticateToken, requireRole('admin')]
    }, async (request, reply) => {
        const { id } = request.params;
        const result = await query('DELETE FROM work_units WHERE id = $1 RETURNING id', [id]);

        if (result.rows.length === 0) {
            return reply.code(404).send({ error: 'Work unit not found' });
        }

        return { message: 'Work unit deleted' };
    });

    // GET /:id/users - Get users in work unit
    fastify.get('/:id/users', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        const { id } = request.params;

        // Check permissions
        if (request.user.role !== 'admin') {
            // Check if user is a manager of this unit
            const check = await query(
                'SELECT 1 FROM work_unit_managers WHERE work_unit_id = $1 AND user_id = $2',
                [id, request.user.id]
            );
            if (check.rows.length === 0) {
                return reply.code(403).send({ error: 'Access denied' });
            }
        }

        const result = await query(`
            SELECT u.id 
            FROM user_work_units uw
            JOIN users u ON uw.user_id = u.id
            WHERE uw.work_unit_id = $1
        `, [id]);

        return result.rows.map(r => r.id);
    });

    // POST /:id/users - Update users in work unit (Admin only)
    fastify.post('/:id/users', {
        onRequest: [authenticateToken, requireRole('admin')]
    }, async (request, reply) => {
        const { id } = request.params;
        const { userIds } = request.body;
        const idResult = requireNonEmptyString(id, 'id');
        if (!idResult.ok) return badRequest(reply, idResult.message);

        const userIdsResult = optionalArrayOfStrings(userIds, 'userIds');
        if (!userIdsResult.ok) return badRequest(reply, userIdsResult.message);

        try {
            await query('BEGIN');
            await query('DELETE FROM user_work_units WHERE work_unit_id = $1', [idResult.value]);

            for (const userId of userIdsResult.value || []) {
                await query(
                    'INSERT INTO user_work_units (user_id, work_unit_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [userId, idResult.value]
                );
            }

            await query('COMMIT');
            return { message: 'Work unit users updated' };
        } catch (err) {
            await query('ROLLBACK');
            throw err;
        }
    });
}
