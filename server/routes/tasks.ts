import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query, withTransaction } from '../db/index.ts';
import { authenticateToken, requireAnyPermission, requirePermission } from '../middleware/auth.ts';
import {
  messageResponseSchema,
  standardErrorResponses,
  standardRateLimitedErrorResponses,
} from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
import { assertAuthenticated } from '../utils/auth-assert.ts';
import { normalizeNullableDateOnly, todayLocalDateOnly } from '../utils/date.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import {
  assignClientToTopManagers,
  assignClientToUser,
  assignProjectToTopManagers,
  assignProjectToUser,
  assignTaskToTopManagers,
  assignTaskToUser,
} from '../utils/top-manager-assignments.ts';
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
    expectedEffort: { type: 'number' },
    revenue: { type: 'number' },
    notes: { type: ['string', 'null'] },
    isDisabled: { type: 'boolean' },
    createdAt: { type: 'number' },
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
    expectedEffort: { type: 'number' },
    revenue: { type: 'number' },
    notes: { type: 'string' },
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
    expectedEffort: { type: 'number' },
    revenue: { type: 'number' },
    notes: { type: 'string' },
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
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
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
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;

      const canViewAll = hasPermission(request, 'projects.tasks_all.view');
      let queryText = `
            SELECT id, name, project_id, description, is_recurring,
                   recurrence_pattern, recurrence_start, recurrence_end, recurrence_duration,
                   expected_effort, revenue, notes, is_disabled,
                   EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt"
            FROM tasks ORDER BY name
        `;
      let queryParams: string[] = [];

      if (!canViewAll) {
        queryText = `
                SELECT t.id, t.name, t.project_id, t.description, t.is_recurring,
                       t.recurrence_pattern, t.recurrence_start, t.recurrence_end, t.recurrence_duration,
                       t.expected_effort, t.revenue, t.notes, t.is_disabled,
                       EXTRACT(EPOCH FROM t.created_at) * 1000 as "createdAt"
                FROM tasks t
                INNER JOIN user_tasks ut ON t.id = ut.task_id
                WHERE ut.user_id = $1
                ORDER BY t.name
            `;
        queryParams = [request.user.id];
      }

      const result = await query(queryText, queryParams);
      const value = result.rows.map((t) => ({
        id: t.id,
        name: t.name,
        projectId: t.project_id,
        description: t.description,
        isRecurring: t.is_recurring,
        recurrencePattern: t.recurrence_pattern,
        recurrenceStart:
          normalizeNullableDateOnly(t.recurrence_start, 'task.recurrenceStart') ?? undefined,
        recurrenceEnd:
          normalizeNullableDateOnly(t.recurrence_end, 'task.recurrenceEnd') ?? undefined,
        recurrenceDuration: parseFloat(t.recurrence_duration || 0),
        expectedEffort: t.expected_effort !== null ? parseFloat(t.expected_effort) : undefined,
        revenue: t.revenue !== null ? parseFloat(t.revenue) : undefined,
        notes: t.notes ?? undefined,
        isDisabled: t.is_disabled,
        createdAt: t.createdAt ? parseFloat(t.createdAt) : undefined,
      }));

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
      const {
        name,
        projectId,
        description,
        isRecurring,
        recurrencePattern,
        recurrenceStart,
        notes,
      } = request.body as {
        name: string;
        projectId: string;
        description?: string;
        isRecurring?: boolean;
        recurrencePattern?: string;
        recurrenceStart?: string;
        recurrenceDuration?: number;
        expectedEffort?: number;
        revenue?: number;
        notes?: string;
      };
      const expectedEffortRaw = (request.body as { expectedEffort?: number }).expectedEffort;
      const revenueRaw = (request.body as { revenue?: number }).revenue;
      const expectedEffortVal =
        expectedEffortRaw !== undefined ? parseFloat(String(expectedEffortRaw)) : 0;
      const revenueVal = revenueRaw !== undefined ? parseFloat(String(revenueRaw)) : 0;

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
        start = recurrenceStartResult.value || todayLocalDateOnly();
      }

      const id = 't-' + crypto.randomUUID();

      try {
        await query(
          `INSERT INTO tasks (id, name, project_id, description, is_recurring, recurrence_pattern, recurrence_start, recurrence_duration, expected_effort, revenue, notes, is_disabled)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            id,
            nameResult.value,
            projectIdResult.value,
            description || null,
            isRecurringValue,
            recurrencePattern || null,
            start,
            durationResult.value || 0,
            expectedEffortVal,
            revenueVal,
            notes || null,
            false,
          ],
        );

        const projectResult = await query('SELECT client_id FROM projects WHERE id = $1', [
          projectIdResult.value,
        ]);
        const clientId = projectResult.rows[0]?.client_id as string | undefined;

        if (request.user?.id) {
          if (clientId) {
            await assignClientToUser(request.user.id, clientId);
          }
          await assignProjectToUser(request.user.id, projectIdResult.value);
          await assignTaskToUser(request.user.id, id);
        }
        if (clientId) {
          await assignClientToTopManagers(clientId);
        }
        await assignProjectToTopManagers(projectIdResult.value);
        await assignTaskToTopManagers(id);
        await logAudit({
          request,
          action: 'task.created',
          entityType: 'task',
          entityId: id,
          details: {
            targetLabel: nameResult.value,
            secondaryLabel: projectIdResult.value,
          },
        });
        return reply.code(201).send({
          id,
          name: nameResult.value,
          projectId: projectIdResult.value,
          description,
          isRecurring: isRecurringValue,
          recurrencePattern,
          recurrenceStart: start,
          recurrenceDuration: durationResult.value || 0,
          expectedEffort: expectedEffortVal,
          revenue: revenueVal,
          notes: notes || null,
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

  // Literal path — Fastify's radix-tree router matches this before /:id parameterized routes
  fastify.get(
    '/hours/batch',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
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
        summary: 'Get total logged hours per task for multiple projects',
        querystring: {
          type: 'object',
          required: ['projectIds'],
          properties: { projectIds: { type: 'string' } },
        },
        response: {
          200: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              additionalProperties: { type: 'number' },
            },
          },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;

      const { projectIds } = request.query as { projectIds: string };
      const idsResult = requireNonEmptyString(projectIds, 'projectIds');
      if (!idsResult.ok) return badRequest(reply, idsResult.message);

      const idArray = idsResult.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (idArray.length === 0) return badRequest(reply, 'projectIds must contain at least one ID');
      if (idArray.length > 200) return badRequest(reply, 'projectIds cannot exceed 200 IDs');

      const canViewAll = hasPermission(request, 'projects.tasks_all.view');
      let queryText: string;
      let queryParams: unknown[];

      if (canViewAll) {
        queryText = `
          SELECT project_id, task, COALESCE(SUM(duration), 0)::float AS total
          FROM time_entries
          WHERE project_id = ANY($1)
          GROUP BY project_id, task
        `;
        queryParams = [idArray];
      } else {
        queryText = `
          SELECT te.project_id, te.task, COALESCE(SUM(te.duration), 0)::float AS total
          FROM time_entries te
          INNER JOIN tasks t ON t.name = te.task AND t.project_id = te.project_id
          INNER JOIN user_tasks ut ON t.id = ut.task_id
          WHERE te.project_id = ANY($1) AND ut.user_id = $2
          GROUP BY te.project_id, te.task
        `;
        queryParams = [idArray, request.user.id];
      }

      const result = await query(queryText, queryParams);
      const hours: Record<string, Record<string, number>> = {};
      for (const row of result.rows) {
        const pid = row.project_id as string;
        if (!hours[pid]) hours[pid] = {};
        hours[pid][row.task as string] = Number(row.total);
      }
      return reply.send(hours);
    },
  );

  // GET /hours - Get total hours logged per task for a project
  fastify.get(
    '/hours',
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
        summary: 'Get total logged hours per task for a project',
        querystring: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string' } },
        },
        response: {
          200: { type: 'object', additionalProperties: { type: 'number' } },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;

      const { projectId } = request.query as { projectId: string };
      const projectIdResult = requireNonEmptyString(projectId, 'projectId');
      if (!projectIdResult.ok) return badRequest(reply, projectIdResult.message);

      const canViewAll = hasPermission(request, 'projects.tasks_all.view');
      let queryText =
        'SELECT task, COALESCE(SUM(duration), 0)::float AS total FROM time_entries WHERE project_id = $1 GROUP BY task';
      let queryParams: string[] = [projectIdResult.value];

      if (!canViewAll) {
        queryText = `
          SELECT te.task, COALESCE(SUM(te.duration), 0)::float AS total
          FROM time_entries te
          INNER JOIN tasks t ON t.name = te.task AND t.project_id = te.project_id
          INNER JOIN user_tasks ut ON t.id = ut.task_id
          WHERE te.project_id = $1 AND ut.user_id = $2
          GROUP BY te.task
        `;
        queryParams = [projectIdResult.value, request.user.id];
      }

      const result = await query(queryText, queryParams);
      const hours: Record<string, number> = {};
      for (const row of result.rows) hours[row.task as string] = Number(row.total);
      return reply.send(hours);
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
        notes,
      } = request.body as {
        name?: string;
        description?: string;
        isRecurring?: boolean;
        recurrencePattern?: string;
        recurrenceStart?: string;
        recurrenceEnd?: string;
        isDisabled?: boolean;
        recurrenceDuration?: number;
        expectedEffort?: number;
        revenue?: number;
        notes?: string;
      };
      const updateExpectedEffort = (request.body as { expectedEffort?: number }).expectedEffort;
      const updateRevenue = (request.body as { revenue?: number }).revenue;
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
                 is_disabled = COALESCE($9, is_disabled),
                 expected_effort = COALESCE($10, expected_effort),
                 revenue = COALESCE($11, revenue),
                 notes = COALESCE($12, notes)
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
          updateExpectedEffort !== undefined ? parseFloat(String(updateExpectedEffort)) : null,
          updateRevenue !== undefined ? parseFloat(String(updateRevenue)) : null,
          notes !== undefined ? notes : null,
        ],
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Task not found' });
      }

      const t = result.rows[0];
      const isDisabledChanged = isDisabled !== undefined;
      const changedFields = [
        name !== undefined ? 'name' : null,
        description !== undefined ? 'description' : null,
        isRecurring !== undefined ? 'isRecurring' : null,
        recurrencePattern !== undefined ? 'recurrencePattern' : null,
        recurrenceStart !== undefined ? 'recurrenceStart' : null,
        recurrenceEnd !== undefined ? 'recurrenceEnd' : null,
        (request.body as { recurrenceDuration?: number }).recurrenceDuration !== undefined
          ? 'recurrenceDuration'
          : null,
        isDisabledChanged ? 'isDisabled' : null,
      ].filter((field): field is string => field !== null);

      // Determine specific action based on what changed
      let action = 'task.updated';
      if (changedFields.length === 1 && changedFields[0] === 'isDisabled') {
        action = isDisabled ? 'task.disabled' : 'task.enabled';
      }

      await logAudit({
        request,
        action,
        entityType: 'task',
        entityId: idResult.value,
        details: {
          targetLabel: t.name as string,
          secondaryLabel: t.project_id as string,
        },
      });
      return {
        id: t.id,
        name: t.name,
        projectId: t.project_id,
        description: t.description,
        isRecurring: t.is_recurring,
        recurrencePattern: t.recurrence_pattern,
        recurrenceStart:
          normalizeNullableDateOnly(t.recurrence_start, 'task.recurrenceStart') ?? undefined,
        recurrenceEnd:
          normalizeNullableDateOnly(t.recurrence_end, 'task.recurrenceEnd') ?? undefined,
        recurrenceDuration: parseFloat(t.recurrence_duration || 0),
        expectedEffort: t.expected_effort !== null ? parseFloat(t.expected_effort) : undefined,
        revenue: t.revenue !== null ? parseFloat(t.revenue) : undefined,
        notes: t.notes ?? undefined,
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
      const result = await query('DELETE FROM tasks WHERE id = $1 RETURNING id, name, project_id', [
        idResult.value,
      ]);
      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Task not found' });
      }

      await logAudit({
        request,
        action: 'task.deleted',
        entityType: 'task',
        entityId: idResult.value,
        details: {
          targetLabel: result.rows[0].name as string,
          secondaryLabel: result.rows[0].project_id as string,
        },
      });
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
      const taskResult = await query('SELECT name, project_id FROM tasks WHERE id = $1', [
        idResult.value,
      ]);
      if (taskResult.rows.length === 0) {
        return reply.code(404).send({ error: 'Task not found' });
      }

      await withTransaction(async (tx) => {
        await tx.query('DELETE FROM user_tasks WHERE task_id = $1', [idResult.value]);

        for (const userId of validUserIds) {
          await tx.query(
            'INSERT INTO user_tasks (user_id, task_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [userId, idResult.value],
          );
        }
      });

      await logAudit({
        request,
        action: 'task.users_assigned',
        entityType: 'task',
        entityId: idResult.value,
        details: {
          targetLabel: taskResult.rows[0].name as string,
          counts: { users: validUserIds.length },
        },
      });
      return { message: 'Task assignments updated' };
    },
  );
}
