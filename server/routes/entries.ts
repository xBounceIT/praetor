import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requireRole } from '../middleware/auth.ts';
import {
  requireNonEmptyString,
  parseDateString,
  parseLocalizedNonNegativeNumber,
  optionalLocalizedNonNegativeNumber,
  parseBoolean,
  optionalNonEmptyString,
  badRequest,
  parseQueryBoolean,
  isWeekendDate,
} from '../utils/validation.ts';
import { messageResponseSchema, standardErrorResponses } from '../schemas/common.ts';

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const entrySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    date: { type: 'string', format: 'date' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    projectId: { type: 'string' },
    projectName: { type: 'string' },
    task: { type: 'string' },
    notes: { type: ['string', 'null'] },
    duration: { type: 'number' },
    hourlyCost: { type: 'number' },
    isPlaceholder: { type: 'boolean' },
    location: { type: 'string' },
    createdAt: { type: 'number' },
  },
  required: [
    'id',
    'userId',
    'date',
    'clientId',
    'clientName',
    'projectId',
    'projectName',
    'task',
    'duration',
    'hourlyCost',
    'isPlaceholder',
    'location',
    'createdAt',
  ],
} as const;

const entryCreateBodySchema = {
  type: 'object',
  properties: {
    date: { type: 'string', format: 'date' },
    clientId: { type: 'string' },
    clientName: { type: 'string' },
    projectId: { type: 'string' },
    projectName: { type: 'string' },
    task: { type: 'string' },
    notes: { type: 'string' },
    duration: { type: 'number' },
    isPlaceholder: { type: 'boolean' },
    userId: { type: 'string' },
    location: { type: 'string' },
  },
  required: ['date', 'clientId', 'clientName', 'projectId', 'projectName', 'task'],
} as const;

const entryUpdateBodySchema = {
  type: 'object',
  properties: {
    duration: { type: 'number' },
    notes: { type: 'string' },
    isPlaceholder: { type: 'boolean' },
    location: { type: 'string' },
  },
} as const;

const entriesListQuerySchema = {
  type: 'object',
  properties: {
    userId: { type: 'string' },
  },
} as const;

const entriesBulkDeleteQuerySchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string' },
    task: { type: 'string' },
    futureOnly: { type: 'boolean' },
    placeholderOnly: { type: 'boolean' },
  },
  required: ['projectId', 'task'],
} as const;

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // GET / - List time entries
  fastify.get(
    '/',
    {
      onRequest: [authenticateToken, requireRole('manager', 'user')],
      schema: {
        tags: ['entries'],
        summary: 'List time entries',
        querystring: entriesListQuerySchema,
        response: {
          200: { type: 'array', items: entrySchema },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      let result;

      if (request.user!.role === 'manager') {
        // Managers can see their own entries and those of users in their work units
        const { userId } = request.query as { userId?: string };

        if (userId) {
          // If requesting specific user, verify permission
          if (userId !== request.user!.id) {
            const managedCheck = await query(
              `SELECT 1 
                         FROM user_work_units uwu
                         JOIN work_unit_managers wum ON uwu.work_unit_id = wum.work_unit_id
                         WHERE wum.user_id = $1 AND uwu.user_id = $2`,
              [request.user!.id, userId],
            );

            if (managedCheck.rows.length === 0) {
              return reply
                .code(403)
                .send({ error: 'Not authorized to view entries for this user' });
            }
          }

          result = await query(
            `SELECT id, user_id, date, client_id, client_name, project_id,
                  project_name, task, notes, duration, hourly_cost, is_placeholder, location, created_at
           FROM time_entries WHERE user_id = $1 ORDER BY created_at DESC`,
            [userId],
          );
        } else {
          // No specific user requested, return all accessible (own + managed)
          result = await query(
            `SELECT id, user_id, date, client_id, client_name, project_id,
                  project_name, task, notes, duration, hourly_cost, is_placeholder, location, created_at
           FROM time_entries
           WHERE user_id = $1
             OR user_id IN (
                  SELECT uwu.user_id
                  FROM user_work_units uwu
                  JOIN work_unit_managers wum ON uwu.work_unit_id = wum.work_unit_id
                  WHERE wum.user_id = $1
              )
           ORDER BY created_at DESC`,
            [request.user!.id],
          );
        }
      } else {
        // Regular users can only see their own entries
        result = await query(
          `SELECT id, user_id, date, client_id, client_name, project_id,
                project_name, task, notes, duration, hourly_cost, is_placeholder, location, created_at
         FROM time_entries WHERE user_id = $1 ORDER BY created_at DESC`,
          [request.user!.id],
        );
      }

      const entries = result.rows.map((e) => ({
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
        location: e.location || 'remote',
        createdAt: new Date(e.created_at).getTime(),
      }));

      return entries;
    },
  );

  // POST / - Create time entry
  fastify.post(
    '/',
    {
      onRequest: [authenticateToken, requireRole('manager', 'user')],
      schema: {
        tags: ['entries'],
        summary: 'Create time entry',
        body: entryCreateBodySchema,
        response: {
          201: entrySchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        date,
        clientId,
        clientName,
        projectId,
        projectName,
        task,
        notes,
        duration,
        isPlaceholder,
        userId,
        location,
      } = request.body as {
        date: string;
        clientId: string;
        clientName: string;
        projectId: string;
        projectName: string;
        task: string;
        notes?: string;
        duration?: number;
        isPlaceholder?: boolean;
        userId?: string;
        location?: string;
      };

      const dateResult = parseDateString(date, 'date');
      if (!dateResult.ok) return badRequest(reply, dateResult.message);

      // Weekend validation
      if (isWeekendDate(dateResult.value)) {
        const settingsResult = await query(
          'SELECT allow_weekend_selection FROM general_settings WHERE id = 1',
        );
        const allowWeekendSelection = settingsResult.rows[0]?.allow_weekend_selection ?? true;

        if (!allowWeekendSelection) {
          return badRequest(reply, 'Time entries on weekends are not allowed');
        }
      }

      const clientIdResult = requireNonEmptyString(clientId, 'clientId');
      if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);

      const clientNameResult = requireNonEmptyString(clientName, 'clientName');
      if (!clientNameResult.ok) return badRequest(reply, clientNameResult.message);

      const projectIdResult = requireNonEmptyString(projectId, 'projectId');
      if (!projectIdResult.ok) return badRequest(reply, projectIdResult.message);

      const projectNameResult = requireNonEmptyString(projectName, 'projectName');
      if (!projectNameResult.ok) return badRequest(reply, projectNameResult.message);

      const taskResult = requireNonEmptyString(task, 'task');
      if (!taskResult.ok) return badRequest(reply, taskResult.message);

      const durationResult = optionalLocalizedNonNegativeNumber(duration, 'duration');
      if (!durationResult.ok) return badRequest(reply, durationResult.message);

      const isPlaceholderValue = parseBoolean(isPlaceholder);

      // Allow managers to create entries for other users
      let targetUserId = request.user!.id;
      if (userId && request.user!.role === 'manager') {
        targetUserId = userId;
        const targetUserIdResult = requireNonEmptyString(targetUserId, 'userId');
        if (!targetUserIdResult.ok) return badRequest(reply, targetUserIdResult.message);
        targetUserId = targetUserIdResult.value;

        // Verify manager has access to this user
        if (targetUserId !== request.user!.id) {
          const managedCheck = await query(
            `SELECT 1 
                     FROM user_work_units uwu
                     JOIN work_unit_managers wum ON uwu.work_unit_id = wum.work_unit_id
                     WHERE wum.user_id = $1 AND uwu.user_id = $2`,
            [request.user!.id, targetUserId],
          );
          if (managedCheck.rows.length === 0) {
            return reply
              .code(403)
              .send({ error: 'Not authorized to create entries for this user' });
          }
        }
      }

      // Fetch user's current cost
      const userResult = await query('SELECT cost_per_hour FROM users WHERE id = $1', [
        targetUserId,
      ]);
      const hourlyCost = userResult.rows[0]?.cost_per_hour || 0;

      const id = Math.random().toString(36).substr(2, 9);

      const locationValue = location || 'remote';

      await query(
        `INSERT INTO time_entries (id, user_id, date, client_id, client_name, project_id, project_name, task, notes, duration, hourly_cost, is_placeholder, location)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          id,
          targetUserId,
          dateResult.value,
          clientIdResult.value,
          clientNameResult.value,
          projectIdResult.value,
          projectNameResult.value,
          taskResult.value,
          notes || null,
          durationResult.value || 0,
          hourlyCost,
          isPlaceholderValue,
          locationValue,
        ],
      );

      return reply.code(201).send({
        id,
        userId: targetUserId,
        date: dateResult.value,
        clientId: clientIdResult.value,
        clientName: clientNameResult.value,
        projectId: projectIdResult.value,
        projectName: projectNameResult.value,
        task: taskResult.value,
        notes,
        duration: durationResult.value || 0,
        hourlyCost: parseFloat(hourlyCost),
        isPlaceholder: isPlaceholderValue,
        location: locationValue,
        createdAt: Date.now(),
      });
    },
  );

  // PUT /:id - Update time entry
  fastify.put(
    '/:id',
    {
      onRequest: [authenticateToken, requireRole('manager', 'user')],
      schema: {
        tags: ['entries'],
        summary: 'Update time entry',
        params: idParamSchema,
        body: entryUpdateBodySchema,
        response: {
          200: entrySchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { duration, notes, isPlaceholder, location } = request.body as {
        duration?: number;
        notes?: string;
        isPlaceholder?: boolean;
        location?: string;
      };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      if (duration !== undefined) {
        const durationResult = parseLocalizedNonNegativeNumber(duration, 'duration');
        if (!durationResult.ok) return badRequest(reply, durationResult.message);
      }

      if (notes !== undefined) {
        const notesResult = optionalNonEmptyString(notes, 'notes');
        if (!notesResult.ok) return badRequest(reply, notesResult.message);
      }

      // Check ownership or admin/manager role
      const existing = await query('SELECT user_id FROM time_entries WHERE id = $1', [
        idResult.value,
      ]);
      if (existing.rows.length === 0) {
        return reply.code(404).send({ error: 'Entry not found' });
      }

      if (existing.rows[0].user_id !== request.user!.id) {
        if (request.user!.role === 'user') {
          return reply.code(403).send({ error: 'Not authorized to update this entry' });
        }

        if (request.user!.role === 'manager') {
          const managedCheck = await query(
            `SELECT 1
                     FROM user_work_units uwu
                     JOIN work_unit_managers wum ON uwu.work_unit_id = wum.work_unit_id
                     WHERE wum.user_id = $1 AND uwu.user_id = $2`,
            [request.user!.id, existing.rows[0].user_id],
          );
          if (managedCheck.rows.length === 0) {
            return reply.code(403).send({ error: 'Not authorized to update this entry' });
          }
        }
      }

      const result = await query(
        `UPDATE time_entries
       SET duration = COALESCE($2, duration),
           notes = COALESCE($3, notes),
           is_placeholder = COALESCE($4, is_placeholder),
           location = COALESCE($5, location)
       WHERE id = $1
       RETURNING *`,
        [idResult.value, duration, notes, isPlaceholder, location],
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
        location: e.location || 'remote',
        createdAt: new Date(e.created_at).getTime(),
      };
    },
  );

  // DELETE /:id - Delete time entry
  fastify.delete(
    '/:id',
    {
      onRequest: [authenticateToken, requireRole('manager', 'user')],
      schema: {
        tags: ['entries'],
        summary: 'Delete time entry',
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

      // Check ownership or admin/manager role
      const existing = await query('SELECT user_id FROM time_entries WHERE id = $1', [
        idResult.value,
      ]);
      if (existing.rows.length === 0) {
        return reply.code(404).send({ error: 'Entry not found' });
      }

      if (existing.rows[0].user_id !== request.user!.id) {
        if (request.user!.role === 'user') {
          return reply.code(403).send({ error: 'Not authorized to delete this entry' });
        }

        if (request.user!.role === 'manager') {
          const managedCheck = await query(
            `SELECT 1 
                     FROM user_work_units uwu
                     JOIN work_unit_managers wum ON uwu.work_unit_id = wum.work_unit_id
                     WHERE wum.user_id = $1 AND uwu.user_id = $2`,
            [request.user!.id, existing.rows[0].user_id],
          );
          if (managedCheck.rows.length === 0) {
            return reply.code(403).send({ error: 'Not authorized to delete this entry' });
          }
        }
      }

      await query('DELETE FROM time_entries WHERE id = $1', [idResult.value]);
      return { message: 'Entry deleted' };
    },
  );

  // DELETE / - Bulk delete entries (for recurring cleanup)
  fastify.delete(
    '/',
    {
      onRequest: [authenticateToken, requireRole('manager', 'user')],
      schema: {
        tags: ['entries'],
        summary: 'Bulk delete time entries',
        querystring: entriesBulkDeleteQuerySchema,
        response: {
          200: messageResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId, task, futureOnly, placeholderOnly } = request.query as {
        projectId: string;
        task: string;
        futureOnly?: string;
        placeholderOnly?: string;
      };

      const projectIdResult = requireNonEmptyString(projectId, 'projectId');
      if (!projectIdResult.ok) return badRequest(reply, projectIdResult.message);

      const taskResult = requireNonEmptyString(task, 'task');
      if (!taskResult.ok) return badRequest(reply, taskResult.message);

      const futureOnlyValue = parseQueryBoolean(futureOnly) || false;
      const placeholderOnlyValue = parseQueryBoolean(placeholderOnly) || false;

      let sql = 'DELETE FROM time_entries WHERE project_id = $1 AND task = $2';
      const params: (string | boolean)[] = [projectIdResult.value, taskResult.value];
      let paramIndex = 3;

      // Only delete user's own entries unless manager (who can delete managed users' entries)
      if (request.user!.role === 'user') {
        sql += ` AND user_id = $${paramIndex++}`;
        params.push(request.user!.id);
      } else if (request.user!.role === 'manager') {
        sql += ` AND (user_id = $${paramIndex} OR user_id IN (
                  SELECT uwu.user_id 
                  FROM user_work_units uwu
                  JOIN work_unit_managers wum ON uwu.work_unit_id = wum.work_unit_id
                  WHERE wum.user_id = $${paramIndex}
              ))`;
        params.push(request.user!.id);
        paramIndex++;
      }

      if (futureOnlyValue === true) {
        sql += ` AND date >= $${paramIndex++}`;
        params.push(new Date().toISOString().split('T')[0]);
      }

      if (placeholderOnlyValue === true) {
        sql += ' AND is_placeholder = true';
      }

      const result = await query(sql + ' RETURNING id', params);
      return { message: `Deleted ${result.rows.length} entries` };
    },
  );
}
