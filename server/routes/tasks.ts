import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requireAnyPermission, requirePermission } from '../middleware/auth.ts';
import { messageResponseSchema, standardErrorResponses } from '../schemas/common.ts';
import {
  TTL_LIST_SECONDS,
  bumpNamespaceVersion,
  cacheGetSetJson,
  setCacheHeader,
  shouldBypassCache,
} from '../services/cache.ts';
import {
  badRequest,
  optionalDateString,
  optionalLocalizedNonNegativeNumber,
  parseBoolean,
  parseDateString,
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

const taskSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    projectId: { type: 'string' },
    description: { type: ['string', 'null'] },
    isRecurring: { type: 'boolean' },
    recurrencePattern: { type: ['string', 'null'] },
    recurrenceStart: { type: ['string', 'null'] },
    recurrenceEnd: { type: ['string', 'null'] },
    recurrenceDuration: { type: 'number' },
    isDisabled: { type: 'boolean' },
  },
  required: ['id', 'name', 'projectId', 'isRecurring', 'recurrenceDuration', 'isDisabled'],
} as const;

const taskCreateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    projectId: { type: 'string' },
    description: { type: 'string' },
    isRecurring: { type: 'boolean' },
    recurrencePattern: { type: 'string' },
    recurrenceStart: { type: 'string' },
    recurrenceDuration: { type: 'number' },
  },
  required: ['name', 'projectId'],
} as const;

const taskUpdateBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    isRecurring: { type: 'boolean' },
    recurrencePattern: { type: 'string' },
    recurrenceStart: { type: 'string' },
    recurrenceEnd: { type: 'string' },
    recurrenceDuration: { type: 'number' },
    isDisabled: { type: 'boolean' },
  },
} as const;

const userIdsSchema = {
  type: 'object',
  properties: {
    userIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['userIds'],
} as const;

interface DatabaseError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
}

const hasPermission = (request: FastifyRequest, permission: string) =>
  request.user?.permissions?.includes(permission) ?? false;

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // GET / - List all tasks
  fastify.get(
    '/',
    {
      onRequest: [
        authenticateToken,
        requireAnyPermission(
          'projects.tasks.view',
          'projects.manage.view',
          'timesheets.tracker.view',
          'timesheets.recurring.view',
        ),
      ],
      schema: {
        tags: ['tasks'],
        summary: 'List tasks',
        response: {
          200: { type: 'array', items: taskSchema },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const canViewAll = hasPermission(request, 'projects.tasks_all.view');
      const scopeKey = canViewAll ? 'all' : `user:${request.user!.id}`;
      const bypass = shouldBypassCache(request);

      const { status, value } = await cacheGetSetJson(
        'tasks',
        `v=1:scope=${scopeKey}`,
        TTL_LIST_SECONDS,
        async () => {
          let queryText = `
            SELECT id, name, project_id, description, is_recurring, 
                   recurrence_pattern, recurrence_start, recurrence_end, recurrence_duration, is_disabled 
            FROM tasks ORDER BY name
        `;
          let queryParams: string[] = [];

          if (!canViewAll) {
            queryText = `
                SELECT t.id, t.name, t.project_id, t.description, t.is_recurring, 
                       t.recurrence_pattern, t.recurrence_start, t.recurrence_end, t.recurrence_duration, t.is_disabled 
                FROM tasks t
                INNER JOIN user_tasks ut ON t.id = ut.task_id
                WHERE ut.user_id = $1
                ORDER BY t.name
            `;
            queryParams = [request.user!.id];
          }

          const result = await query(queryText, queryParams);
          return result.rows.map((t) => ({
            id: t.id,
            name: t.name,
            projectId: t.project_id,
            description: t.description,
            isRecurring: t.is_recurring,
            recurrencePattern: t.recurrence_pattern,
            recurrenceStart: t.recurrence_start
              ? t.recurrence_start.toISOString().split('T')[0]
              : undefined,
            recurrenceEnd: t.recurrence_end
              ? t.recurrence_end.toISOString().split('T')[0]
              : undefined,
            recurrenceDuration: parseFloat(t.recurrence_duration || 0),
            isDisabled: t.is_disabled,
          }));
        },
        { bypass },
      );

      setCacheHeader(reply, status);
      return value;
    },
  );

  // POST / - Create task
  fastify.post(
    '/',
    {
      onRequest: [authenticateToken, requirePermission('projects.tasks.create')],
      schema: {
        tags: ['tasks'],
        summary: 'Create task',
        body: taskCreateBodySchema,
        response: {
          201: taskSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { name, projectId, description, isRecurring, recurrencePattern, recurrenceStart } =
        request.body as {
          name: string;
          projectId: string;
          description?: string;
          isRecurring?: boolean;
          recurrencePattern?: string;
          recurrenceStart?: string;
          recurrenceDuration?: number;
        };

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const projectIdResult = requireNonEmptyString(projectId, 'projectId');
      if (!projectIdResult.ok) return badRequest(reply, projectIdResult.message);

      const durationResult = optionalLocalizedNonNegativeNumber(
        (request.body as { recurrenceDuration?: number }).recurrenceDuration,
        'recurrenceDuration',
      );
      if (!durationResult.ok) return badRequest(reply, durationResult.message);

      const isRecurringValue = parseBoolean(isRecurring);
      let start = null;
      if (isRecurringValue) {
        const patternResult = requireNonEmptyString(recurrencePattern, 'recurrencePattern');
        if (!patternResult.ok) return badRequest(reply, patternResult.message);
        const recurrenceStartResult = optionalDateString(recurrenceStart, 'recurrenceStart');
        if (!recurrenceStartResult.ok) return badRequest(reply, recurrenceStartResult.message);
        start = recurrenceStartResult.value || new Date().toISOString().split('T')[0];
      }

      const id = 't-' + Date.now();

      try {
        await query(
          `INSERT INTO tasks (id, name, project_id, description, is_recurring, recurrence_pattern, recurrence_start, recurrence_duration, is_disabled) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            id,
            nameResult.value,
            projectIdResult.value,
            description || null,
            isRecurringValue,
            recurrencePattern || null,
            start,
            durationResult.value || 0,
            false,
          ],
        );

        await bumpNamespaceVersion('tasks');
        return reply.code(201).send({
          id,
          name: nameResult.value,
          projectId: projectIdResult.value,
          description,
          isRecurring: isRecurringValue,
          recurrencePattern,
          recurrenceStart: start,
          recurrenceDuration: durationResult.value || 0,
          isDisabled: false,
        });
      } catch (err) {
        const error = err as DatabaseError;
        if (error.code === '23503') {
          // Foreign key violation
          return reply.code(400).send({ error: 'Project not found' });
        }
        throw err;
      }
    },
  );

  // PUT /:id - Update task
  fastify.put(
    '/:id',
    {
      onRequest: [authenticateToken, requirePermission('projects.tasks.update')],
      schema: {
        tags: ['tasks'],
        summary: 'Update task',
        params: idParamSchema,
        body: taskUpdateBodySchema,
        response: {
          200: taskSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const {
        name,
        description,
        isRecurring,
        recurrencePattern,
        recurrenceStart,
        recurrenceEnd,
        isDisabled,
      } = request.body as {
        name?: string;
        description?: string;
        isRecurring?: boolean;
        recurrencePattern?: string;
        recurrenceStart?: string;
        recurrenceEnd?: string;
        isDisabled?: boolean;
        recurrenceDuration?: number;
      };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      const durationResult = optionalLocalizedNonNegativeNumber(
        (request.body as { recurrenceDuration?: number }).recurrenceDuration,
        'recurrenceDuration',
      );
      if (!durationResult.ok) return badRequest(reply, durationResult.message);

      if (recurrenceStart !== undefined && recurrenceStart !== null && recurrenceStart !== '') {
        const startResult = parseDateString(recurrenceStart, 'recurrenceStart');
        if (!startResult.ok)
          return badRequest(reply, (startResult as { ok: false; message: string }).message);
      }

      if (recurrenceEnd !== undefined && recurrenceEnd !== null && recurrenceEnd !== '') {
        const endResult = parseDateString(recurrenceEnd, 'recurrenceEnd');
        if (!endResult.ok)
          return badRequest(reply, (endResult as { ok: false; message: string }).message);
      }

      const isRecurringValue =
        isRecurring === undefined || isRecurring === null ? null : parseBoolean(isRecurring);

      const result = await query(
        `UPDATE tasks 
             SET name = COALESCE($2, name),
                 description = COALESCE($3, description),
                 is_recurring = COALESCE($4, is_recurring),
                 recurrence_pattern = COALESCE($5, recurrence_pattern),
                 recurrence_start = COALESCE($6, recurrence_start),
                 recurrence_end = COALESCE($7, recurrence_end),
                 recurrence_duration = COALESCE($8, recurrence_duration),
                 is_disabled = COALESCE($9, is_disabled)
             WHERE id = $1
             RETURNING *`,
        [
          idResult.value,
          name || null,
          description || null,
          isRecurringValue,
          recurrencePattern || null,
          recurrenceStart || null,
          recurrenceEnd || null,
          durationResult.value,
          isDisabled,
        ],
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Task not found' });
      }

      const t = result.rows[0];
      await bumpNamespaceVersion('tasks');
      return {
        id: t.id,
        name: t.name,
        projectId: t.project_id,
        description: t.description,
        isRecurring: t.is_recurring,
        recurrencePattern: t.recurrence_pattern,
        recurrenceStart: t.recurrence_start
          ? t.recurrence_start.toISOString().split('T')[0]
          : undefined,
        recurrenceEnd: t.recurrence_end ? t.recurrence_end.toISOString().split('T')[0] : undefined,
        recurrenceDuration: parseFloat(t.recurrence_duration || 0),
        isDisabled: t.is_disabled,
      };
    },
  );

  // DELETE /:id - Delete task
  fastify.delete(
    '/:id',
    {
      onRequest: [authenticateToken, requirePermission('projects.tasks.delete')],
      schema: {
        tags: ['tasks'],
        summary: 'Delete task',
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
      const result = await query('DELETE FROM tasks WHERE id = $1 RETURNING id', [idResult.value]);
      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Task not found' });
      }

      await bumpNamespaceVersion('tasks');
      return { message: 'Task deleted' };
    },
  );

  // GET /:id/users - Get assigned users
  fastify.get(
    '/:id/users',
    {
      onRequest: [authenticateToken, requirePermission('projects.tasks.update')],
      schema: {
        tags: ['tasks'],
        summary: 'Get task user assignments',
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
      const result = await query('SELECT user_id FROM user_tasks WHERE task_id = $1', [
        idResult.value,
      ]);
      return result.rows.map((r) => r.user_id);
    },
  );

  // POST /:id/users - Update assigned users
  fastify.post(
    '/:id/users',
    {
      onRequest: [authenticateToken, requirePermission('projects.tasks.update')],
      schema: {
        tags: ['tasks'],
        summary: 'Update task user assignments',
        params: idParamSchema,
        body: userIdsSchema,
        response: {
          200: messageResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { userIds } = request.body as { userIds: string[] };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const userIdsResult = requireNonEmptyArrayOfStrings(userIds, 'userIds');
      if (!userIdsResult.ok) return badRequest(reply, userIdsResult.message);
      const validUserIds = userIdsResult.value;

      try {
        await query('BEGIN');

        // Delete existing assignments
        await query('DELETE FROM user_tasks WHERE task_id = $1', [idResult.value]);

        for (const userId of validUserIds) {
          await query(
            'INSERT INTO user_tasks (user_id, task_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [userId, idResult.value],
          );
        }

        await query('COMMIT');
        await bumpNamespaceVersion('tasks');
        return { message: 'Task assignments updated' };
      } catch (err) {
        await query('ROLLBACK');
        throw err;
      }
    },
  );
}
