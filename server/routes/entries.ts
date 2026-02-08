import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requireAnyPermission, requirePermission } from '../middleware/auth.ts';
import { messageResponseSchema, standardErrorResponses } from '../schemas/common.ts';
import {
  bumpNamespaceVersion,
  cacheGetSetJson,
  setCacheHeader,
  shouldBypassCache,
  TTL_ENTRIES_SECONDS,
} from '../services/cache.ts';
import { assertAuthenticated } from '../utils/auth-assert.ts';
import {
  badRequest,
  isWeekendDate,
  optionalLocalizedNonNegativeNumber,
  optionalNonEmptyString,
  parseBoolean,
  parseDateString,
  parseLocalizedNonNegativeNumber,
  parseQueryBoolean,
  requireNonEmptyString,
} from '../utils/validation.ts';

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

const hasPermission = (request: FastifyRequest, permission: string) =>
  request.user?.permissions?.includes(permission) ?? false;

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // GET / - List time entries
  fastify.get(
    '/',
    {
      onRequest: [authenticateToken, requirePermission('timesheets.tracker.view')],
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
      if (!assertAuthenticated(request, reply)) return;

      let result: Awaited<ReturnType<typeof query>>;
      const { userId } = request.query as { userId?: string };
      const canViewAll = hasPermission(request, 'timesheets.tracker_all.view');
      const bypass = shouldBypassCache(request);
      const viewerId = request.user.id;

      // Non-admin access to a specific user requires a check. Do it outside caching so we can 403 cleanly.
      if (!canViewAll && userId && userId !== viewerId) {
        const managedCheck = await query(
          `SELECT 1
                 FROM user_work_units uwu
                 JOIN work_unit_managers wum ON uwu.work_unit_id = wum.work_unit_id
                 WHERE wum.user_id = $1 AND uwu.user_id = $2`,
          [viewerId, userId],
        );

        if (managedCheck.rows.length === 0) {
          return reply.code(403).send({ error: 'Not authorized to view entries for this user' });
        }
      }

      const scopeKey = canViewAll
        ? userId
          ? `all:user:${userId}`
          : 'all:allUsers'
        : userId
          ? userId === viewerId
            ? `self:${viewerId}`
            : `mgr:${viewerId}:user:${userId}`
          : `self+managed:${viewerId}`;

      const { status, value } = await cacheGetSetJson(
        `entries:user:${viewerId}`,
        `v=1:scope=${scopeKey}`,
        TTL_ENTRIES_SECONDS,
        async () => {
          if (canViewAll) {
            if (userId) {
              result = await query(
                `SELECT id, user_id, date, client_id, client_name, project_id,
                      project_name, task, notes, duration, hourly_cost, is_placeholder, location, created_at
                 FROM time_entries WHERE user_id = $1 ORDER BY created_at DESC`,
                [userId],
              );
            } else {
              result = await query(
                `SELECT id, user_id, date, client_id, client_name, project_id,
                      project_name, task, notes, duration, hourly_cost, is_placeholder, location, created_at
                 FROM time_entries ORDER BY created_at DESC`,
              );
            }
          } else if (userId) {
            result = await query(
              `SELECT id, user_id, date, client_id, client_name, project_id,
                    project_name, task, notes, duration, hourly_cost, is_placeholder, location, created_at
               FROM time_entries WHERE user_id = $1 ORDER BY created_at DESC`,
              [userId],
            );
          } else {
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
              [viewerId],
            );
          }

          return result.rows.map((e) => ({
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
        },
        { bypass },
      );

      setCacheHeader(reply, status);
      return value;
    },
  );

  // POST / - Create time entry
  fastify.post(
    '/',
    {
      onRequest: [authenticateToken, requirePermission('timesheets.tracker.create')],
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

      let targetUserId = request.user?.id;
      if (userId) {
        const targetUserIdResult = requireNonEmptyString(userId, 'userId');
        if (!targetUserIdResult.ok) return badRequest(reply, targetUserIdResult.message);
        targetUserId = targetUserIdResult.value;

        if (
          targetUserId !== request.user?.id &&
          !hasPermission(request, 'timesheets.tracker_all.view')
        ) {
          const managedCheck = await query(
            `SELECT 1 
                     FROM user_work_units uwu
                     JOIN work_unit_managers wum ON uwu.work_unit_id = wum.work_unit_id
                     WHERE wum.user_id = $1 AND uwu.user_id = $2`,
            [request.user?.id, targetUserId],
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

      const created = {
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
      };

      await bumpNamespaceVersion(`entries:user:${targetUserId}`);
      const viewerId = request.user?.id;
      if (viewerId && viewerId !== targetUserId) {
        await bumpNamespaceVersion(`entries:user:${viewerId}`);
      }

      return reply.code(201).send(created);
    },
  );

  // PUT /:id - Update time entry
  fastify.put(
    '/:id',
    {
      onRequest: [authenticateToken, requirePermission('timesheets.tracker.update')],
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

      if (existing.rows[0].user_id !== request.user?.id) {
        if (!hasPermission(request, 'timesheets.tracker_all.view')) {
          const managedCheck = await query(
            `SELECT 1
                     FROM user_work_units uwu
                     JOIN work_unit_managers wum ON uwu.work_unit_id = wum.work_unit_id
                     WHERE wum.user_id = $1 AND uwu.user_id = $2`,
            [request.user?.id, existing.rows[0].user_id],
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
      const targetUserId = e.user_id as string;
      await bumpNamespaceVersion(`entries:user:${targetUserId}`);
      const viewerId = request.user?.id;
      if (viewerId && viewerId !== targetUserId) {
        await bumpNamespaceVersion(`entries:user:${viewerId}`);
      }
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
      onRequest: [authenticateToken, requirePermission('timesheets.tracker.delete')],
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

      const targetUserId = existing.rows[0].user_id as string;

      if (existing.rows[0].user_id !== request.user?.id) {
        if (!hasPermission(request, 'timesheets.tracker_all.view')) {
          const managedCheck = await query(
            `SELECT 1 
                     FROM user_work_units uwu
                     JOIN work_unit_managers wum ON uwu.work_unit_id = wum.work_unit_id
                     WHERE wum.user_id = $1 AND uwu.user_id = $2`,
            [request.user?.id, existing.rows[0].user_id],
          );
          if (managedCheck.rows.length === 0) {
            return reply.code(403).send({ error: 'Not authorized to delete this entry' });
          }
        }
      }

      await query('DELETE FROM time_entries WHERE id = $1', [idResult.value]);
      await bumpNamespaceVersion(`entries:user:${targetUserId}`);
      const viewerId = request.user?.id;
      if (viewerId && viewerId !== targetUserId) {
        await bumpNamespaceVersion(`entries:user:${viewerId}`);
      }
      return { message: 'Entry deleted' };
    },
  );

  // DELETE / - Bulk delete entries (for recurring cleanup)
  fastify.delete(
    '/',
    {
      onRequest: [
        authenticateToken,
        requireAnyPermission('timesheets.tracker.delete', 'timesheets.recurring.delete'),
      ],
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
      if (!assertAuthenticated(request, reply)) return;

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
      if (!hasPermission(request, 'timesheets.tracker_all.view')) {
        sql += ` AND (user_id = $${paramIndex} OR user_id IN (
                  SELECT uwu.user_id 
                  FROM user_work_units uwu
                  JOIN work_unit_managers wum ON uwu.work_unit_id = wum.work_unit_id
                  WHERE wum.user_id = $${paramIndex}
              ))`;
        params.push(request.user.id);
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
      await bumpNamespaceVersion(`entries:user:${request.user.id}`);
      return { message: `Deleted ${result.rows.length} entries` };
    },
  );
}
