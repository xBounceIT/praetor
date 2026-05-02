import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withDbTransaction } from '../db/drizzle.ts';
import { authenticateToken, requireAnyPermission, requirePermission } from '../middleware/auth.ts';
import * as projectsRepo from '../repositories/projectsRepo.ts';
import * as tasksRepo from '../repositories/tasksRepo.ts';
import {
  messageResponseSchema,
  standardErrorResponses,
  standardRateLimitedErrorResponses,
} from '../schemas/common.ts';
import { deriveToggleAction, logAudit } from '../utils/audit.ts';
import { assertAuthenticated } from '../utils/auth-assert.ts';
import { todayLocalDateOnly } from '../utils/date.ts';
import { ForeignKeyError } from '../utils/http-errors.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import { requestHasPermission as hasPermission } from '../utils/permissions.ts';
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
      return canViewAll ? tasksRepo.listAll() : tasksRepo.listForUser(request.user.id);
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
      if (!assertAuthenticated(request, reply)) return;
      const {
        name,
        projectId,
        description,
        isRecurring,
        recurrencePattern,
        recurrenceStart,
        recurrenceDuration,
        expectedEffort,
        revenue,
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
      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const projectIdResult = requireNonEmptyString(projectId, 'projectId');
      if (!projectIdResult.ok) return badRequest(reply, projectIdResult.message);

      const durationResult = optionalLocalizedNonNegativeNumber(
        recurrenceDuration,
        'recurrenceDuration',
      );
      if (!durationResult.ok) return badRequest(reply, durationResult.message);

      const isRecurringValue = parseBoolean(isRecurring);
      let start: string | null = null;
      if (isRecurringValue) {
        const patternResult = requireNonEmptyString(recurrencePattern, 'recurrencePattern');
        if (!patternResult.ok) return badRequest(reply, patternResult.message);
        const recurrenceStartResult = optionalDateString(recurrenceStart, 'recurrenceStart');
        if (!recurrenceStartResult.ok) return badRequest(reply, recurrenceStartResult.message);
        start = recurrenceStartResult.value || todayLocalDateOnly();
      }

      const id = generatePrefixedId('t');

      try {
        const created = await tasksRepo.create({
          id,
          name: nameResult.value,
          projectId: projectIdResult.value,
          description: description || null,
          isRecurring: isRecurringValue,
          recurrencePattern: recurrencePattern || null,
          recurrenceStart: start,
          recurrenceDuration: durationResult.value || 0,
          expectedEffort: expectedEffort ?? 0,
          revenue: revenue ?? 0,
          notes: notes || null,
          isDisabled: false,
        });

        const clientId = await projectsRepo.findClientId(projectIdResult.value);

        if (clientId) await assignClientToUser(request.user.id, clientId);
        await assignProjectToUser(request.user.id, projectIdResult.value);
        await assignTaskToUser(request.user.id, id);
        if (clientId) await assignClientToTopManagers(clientId);
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
        return reply.code(201).send(created);
      } catch (err) {
        if (err instanceof ForeignKeyError) {
          return reply.code(400).send({ error: err.message });
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
      const rows = await tasksRepo.sumHoursByProjects(
        idArray,
        canViewAll ? undefined : request.user.id,
      );

      const hours: Record<string, Record<string, number>> = {};
      for (const row of rows) {
        if (!hours[row.projectId]) hours[row.projectId] = {};
        hours[row.projectId][row.task] = row.total;
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
      const rows = await tasksRepo.sumHoursByProjects(
        [projectIdResult.value],
        canViewAll ? undefined : request.user.id,
      );

      const hours: Record<string, number> = {};
      for (const row of rows) hours[row.task] = row.total;
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
      const body = request.body as {
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
      const {
        name,
        description,
        isRecurring,
        recurrencePattern,
        recurrenceStart,
        recurrenceEnd,
        recurrenceDuration,
        expectedEffort,
        revenue,
        isDisabled,
        notes,
      } = body;
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      const durationResult = optionalLocalizedNonNegativeNumber(
        recurrenceDuration,
        'recurrenceDuration',
      );
      if (!durationResult.ok) return badRequest(reply, durationResult.message);

      if (recurrenceStart !== undefined && recurrenceStart !== null && recurrenceStart !== '') {
        const startResult = parseDateString(recurrenceStart, 'recurrenceStart');
        if (!startResult.ok) return badRequest(reply, startResult.message);
      }

      if (recurrenceEnd !== undefined && recurrenceEnd !== null && recurrenceEnd !== '') {
        const endResult = parseDateString(recurrenceEnd, 'recurrenceEnd');
        if (!endResult.ok) return badRequest(reply, endResult.message);
      }

      const isRecurringValue =
        isRecurring === undefined || isRecurring === null ? undefined : parseBoolean(isRecurring);

      const updated = await tasksRepo.update(idResult.value, {
        name: name || undefined,
        description: description || undefined,
        isRecurring: isRecurringValue,
        recurrencePattern: recurrencePattern || undefined,
        recurrenceStart: recurrenceStart || undefined,
        recurrenceEnd: recurrenceEnd || undefined,
        // optionalLocalizedNonNegativeNumber returns null when the body field is omitted; the
        // dynamic-SET in tasksRepo.update would interpret null as "set to NULL" and clobber the
        // existing recurrence_duration. Forward undefined instead so the column is left alone.
        recurrenceDuration: durationResult.value ?? undefined,
        isDisabled,
        expectedEffort,
        revenue,
        notes,
      });

      if (!updated) {
        return reply.code(404).send({ error: 'Task not found' });
      }

      const changedFields = [
        name !== undefined ? 'name' : null,
        description !== undefined ? 'description' : null,
        isRecurring !== undefined ? 'isRecurring' : null,
        recurrencePattern !== undefined ? 'recurrencePattern' : null,
        recurrenceStart !== undefined ? 'recurrenceStart' : null,
        recurrenceEnd !== undefined ? 'recurrenceEnd' : null,
        recurrenceDuration !== undefined ? 'recurrenceDuration' : null,
        isDisabled !== undefined ? 'isDisabled' : null,
      ].filter((field): field is string => field !== null);

      const action = deriveToggleAction(
        changedFields,
        'isDisabled',
        'task.updated',
        'task.disabled',
        'task.enabled',
        isDisabled,
      );

      await logAudit({
        request,
        action,
        entityType: 'task',
        entityId: idResult.value,
        details: {
          targetLabel: updated.name,
          secondaryLabel: updated.projectId,
        },
      });
      return updated;
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

      const deleted = await tasksRepo.deleteById(idResult.value);
      if (!deleted) {
        return reply.code(404).send({ error: 'Task not found' });
      }

      await logAudit({
        request,
        action: 'task.deleted',
        entityType: 'task',
        entityId: idResult.value,
        details: {
          targetLabel: deleted.name,
          secondaryLabel: deleted.projectId,
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
      return tasksRepo.findAssignedUserIds(idResult.value);
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

      const taskMeta = await tasksRepo.findNameAndProjectId(idResult.value);
      if (!taskMeta) {
        return reply.code(404).send({ error: 'Task not found' });
      }

      await withDbTransaction(async (tx) => {
        await tasksRepo.clearUserAssignments(idResult.value, tx);
        await tasksRepo.addUserAssignments(idResult.value, validUserIds, tx);
      });

      await logAudit({
        request,
        action: 'task.users_assigned',
        entityType: 'task',
        entityId: idResult.value,
        details: {
          targetLabel: taskMeta.name,
          counts: { users: validUserIds.length },
        },
      });
      return { message: 'Task assignments updated' };
    },
  );
}
