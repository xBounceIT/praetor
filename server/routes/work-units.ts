import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import { messageResponseSchema, standardErrorResponses } from '../schemas/common.ts';
import {
  badRequest,
  ensureArrayOfStrings,
  optionalArrayOfStrings,
  optionalNonEmptyString,
  requireNonEmptyArrayOfStrings,
  requireNonEmptyString,
} from '../utils/validation.ts';

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const managerSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
  },
  required: ['id', 'name'],
} as const;

const workUnitSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    managers: { type: 'array', items: managerSchema },
    description: { type: ['string', 'null'] },
    isDisabled: { type: 'boolean' },
    userCount: { type: 'number' },
  },
  required: ['id', 'name', 'managers', 'isDisabled', 'userCount'],
} as const;

const workUnitCreateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    managerIds: { type: 'array', items: { type: 'string' } },
    description: { type: 'string' },
  },
  required: ['name', 'managerIds'],
} as const;

const workUnitUpdateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    managerIds: { type: 'array', items: { type: 'string' } },
    description: { type: 'string' },
    isDisabled: { type: 'boolean' },
  },
} as const;

const workUnitUsersBodySchema = {
  type: 'object',
  properties: {
    userIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['userIds'],
} as const;

const hasPermission = (request: FastifyRequest, permission: string) =>
  request.user?.permissions?.includes(permission) ?? false;

// Helper to fetch unit with managers and user count
const fetchUnitDetails = async (unitId: string) => {
  const result = await query(
    `
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
    `,
    [unitId],
  );
  return result.rows[0];
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // GET / - List work units
  fastify.get(
    '/',
    {
      onRequest: [authenticateToken, requirePermission('configuration.work_units.view')],
      schema: {
        tags: ['work-units'],
        summary: 'List work units',
        response: {
          200: { type: 'array', items: workUnitSchema },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      let result;
      if (hasPermission(request, 'administration.work_units_all.view')) {
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
      } else {
        result = await query(
          `
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
            `,
          [request.user!.id],
        );
      }

      const workUnits = result.rows.map((w) => ({
        id: w.id,
        name: w.name,
        managers: w.managers,
        description: w.description,
        isDisabled: !!w.is_disabled,
        userCount: parseInt(w.user_count),
      }));

      return workUnits;
    },
  );

  // POST / - Create work unit (Admin only)
  fastify.post(
    '/',
    {
      onRequest: [authenticateToken, requirePermission('administration.work_units.create')],
      schema: {
        tags: ['work-units'],
        summary: 'Create work unit',
        body: workUnitCreateBodySchema,
        response: {
          201: workUnitSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { name, managerIds, description } = request.body as {
        name?: string;
        managerIds?: string[];
        description?: string;
      };

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const managerIdsResult = requireNonEmptyArrayOfStrings(managerIds, 'managerIds');
      if (!managerIdsResult.ok) return badRequest(reply, managerIdsResult.message);

      try {
        await query('BEGIN');

        const id = 'wu-' + Date.now();
        await query('INSERT INTO work_units (id, name, description) VALUES ($1, $2, $3)', [
          id,
          nameResult.value,
          description,
        ]);

        for (const managerId of managerIdsResult.value) {
          await query('INSERT INTO work_unit_managers (work_unit_id, user_id) VALUES ($1, $2)', [
            id,
            managerId,
          ]);
          // Also add as member
          await query(
            'INSERT INTO user_work_units (user_id, work_unit_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [managerId, id],
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
          userCount: Number.parseInt(w.user_count ?? '0', 10),
        });
      } catch (err) {
        await query('ROLLBACK');
        throw err;
      }
    },
  );

  // PUT /:id - Update work unit (Admin only)
  fastify.put(
    '/:id',
    {
      onRequest: [authenticateToken, requirePermission('configuration.work_units.update')],
      schema: {
        tags: ['work-units'],
        summary: 'Update work unit',
        params: idParamSchema,
        body: workUnitUpdateBodySchema,
        response: {
          200: workUnitSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { name, managerIds, description, isDisabled } = request.body as {
        name?: string;
        managerIds?: string[];
        description?: string;
        isDisabled?: boolean;
      };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      if (name !== undefined) {
        const nameResult = optionalNonEmptyString(name, 'name');
        if (!nameResult.ok) return badRequest(reply, nameResult.message);
      }

      if (managerIds !== undefined) {
        const managerIdsResult = optionalArrayOfStrings(managerIds, 'managerIds');
        if (!managerIdsResult.ok) return badRequest(reply, managerIdsResult.message);
      }

      try {
        await query('BEGIN');

        // Update basic fields
        if (name !== undefined || description !== undefined || isDisabled !== undefined) {
          const updates = [];
          const values = [];
          let paramIdx = 1;

          if (name !== undefined) {
            updates.push(`name = $${paramIdx++}`);
            const nameResult = optionalNonEmptyString(name, 'name');
            if (!nameResult.ok) {
              await query('ROLLBACK');
              return badRequest(reply, nameResult.message);
            }
            values.push(nameResult.value);
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
              values,
            );
            if (result.rows.length === 0) {
              await query('ROLLBACK');
              return reply.code(404).send({ error: 'Work unit not found' });
            }
          }
        }

        // Update managers if provided
        if (managerIds !== undefined) {
          const managerIdsResult = ensureArrayOfStrings(managerIds, 'managerIds');
          if (!managerIdsResult.ok) {
            await query('ROLLBACK');
            return badRequest(reply, managerIdsResult.message);
          }

          // Delete existing managers
          await query('DELETE FROM work_unit_managers WHERE work_unit_id = $1', [idResult.value]);

          // Insert new managers
          for (const managerId of managerIdsResult.value) {
            await query('INSERT INTO work_unit_managers (work_unit_id, user_id) VALUES ($1, $2)', [
              idResult.value,
              managerId,
            ]);
            // Also add as member
            await query(
              'INSERT INTO user_work_units (user_id, work_unit_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [managerId, idResult.value],
            );
          }
        }

        await query('COMMIT');

        const w = await fetchUnitDetails(idResult.value);
        if (!w) return reply.code(404).send({ error: 'Work unit not found' });

        return {
          id: w.id,
          name: w.name,
          managers: w.managers,
          description: w.description,
          isDisabled: !!w.is_disabled,
          userCount: parseInt(w.user_count),
        };
      } catch (err) {
        await query('ROLLBACK');
        throw err;
      }
    },
  );

  // DELETE /:id - Delete work unit (Admin only)
  fastify.delete(
    '/:id',
    {
      onRequest: [authenticateToken, requirePermission('administration.work_units.delete')],
      schema: {
        tags: ['work-units'],
        summary: 'Delete work unit',
        params: idParamSchema,
        response: {
          200: messageResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const result = await query('DELETE FROM work_units WHERE id = $1 RETURNING id', [
        idResult.value,
      ]);

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Work unit not found' });
      }

      return { message: 'Work unit deleted' };
    },
  );

  // GET /:id/users - Get users in work unit
  fastify.get(
    '/:id/users',
    {
      onRequest: [authenticateToken, requirePermission('configuration.work_units.view')],
      schema: {
        tags: ['work-units'],
        summary: 'Get users in work unit',
        params: idParamSchema,
        response: {
          200: { type: 'array', items: { type: 'string' } },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      // Check permissions
      if (!hasPermission(request, 'administration.work_units_all.view')) {
        // Check if user is a manager of this unit
        const check = await query(
          'SELECT 1 FROM work_unit_managers WHERE work_unit_id = $1 AND user_id = $2',
          [idResult.value, request.user!.id],
        );
        if (check.rows.length === 0) {
          return reply.code(403).send({ error: 'Access denied' });
        }
      }

      const result = await query(
        `
            SELECT u.id 
            FROM user_work_units uw
            JOIN users u ON uw.user_id = u.id
            WHERE uw.work_unit_id = $1
        `,
        [idResult.value],
      );

      return result.rows.map((r) => r.id);
    },
  );

  // POST /:id/users - Update users in work unit (Admin only)
  fastify.post(
    '/:id/users',
    {
      onRequest: [authenticateToken, requirePermission('configuration.work_units.update')],
      schema: {
        tags: ['work-units'],
        summary: 'Update work unit users',
        params: idParamSchema,
        body: workUnitUsersBodySchema,
        response: {
          200: messageResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { userIds } = request.body as { userIds?: string[] };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const userIdsResult = ensureArrayOfStrings(userIds, 'userIds');
      if (!userIdsResult.ok) return badRequest(reply, userIdsResult.message);

      try {
        await query('BEGIN');
        await query('DELETE FROM user_work_units WHERE work_unit_id = $1', [idResult.value]);

        for (const userId of userIdsResult.value) {
          await query(
            'INSERT INTO user_work_units (user_id, work_unit_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [userId, idResult.value],
          );
        }

        await query('COMMIT');
        return { message: 'Work unit users updated' };
      } catch (err) {
        await query('ROLLBACK');
        throw err;
      }
    },
  );
}
