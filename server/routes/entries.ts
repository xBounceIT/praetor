import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken, requireAnyPermission, requirePermission } from '../middleware/auth.ts';
import * as entriesRepo from '../repositories/entriesRepo.ts';
import * as generalSettingsRepo from '../repositories/generalSettingsRepo.ts';
import * as tasksRepo from '../repositories/tasksRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import * as workUnitsRepo from '../repositories/workUnitsRepo.ts';
import {
  messageResponseSchema,
  standardErrorResponses,
  standardRateLimitedErrorResponses,
} from '../schemas/common.ts';
import { assertAuthenticated } from '../utils/auth-assert.ts';
import { todayLocalDateOnly } from '../utils/date.ts';
import { generatePrefixedId } from '../utils/order-ids.ts';
import { requestHasPermission as hasPermission } from '../utils/permissions.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
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
    taskId: { type: ['string', 'null'] },
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
    limit: { type: 'integer', minimum: 1, maximum: 500 },
    cursor: { type: 'string' },
  },
} as const;

const entriesListResponseSchema = {
  type: 'object',
  properties: {
    entries: { type: 'array', items: entrySchema },
    nextCursor: { type: ['string', 'null'] },
  },
  required: ['entries', 'nextCursor'],
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
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requirePermission('timesheets.tracker.view'),
      ],
      schema: {
        tags: ['entries'],
        summary: 'List time entries',
        querystring: entriesListQuerySchema,
        response: {
          200: entriesListResponseSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;

      const { userId, limit, cursor } = request.query as {
        userId?: string;
        limit?: number;
        cursor?: string;
      };
      const canViewAll = hasPermission(request, 'timesheets.tracker_all.view');
      const viewerId = request.user.id;

      if (!canViewAll && userId && userId !== viewerId) {
        const allowed = await workUnitsRepo.isUserManagedBy(viewerId, userId);
        if (!allowed) {
          return reply.code(403).send({ error: 'Not authorized to view entries for this user' });
        }
      }

      const decodedCursor = cursor ? entriesRepo.decodeCursor(cursor) : undefined;
      if (cursor && !decodedCursor) return badRequest(reply, 'cursor is invalid');

      const options = { limit, cursor: decodedCursor ?? undefined };
      const result = userId
        ? await entriesRepo.listForUser(userId, options)
        : canViewAll
          ? await entriesRepo.listAll(options)
          : await entriesRepo.listForManagerView(viewerId, options);

      return {
        entries: result.entries,
        nextCursor: result.nextCursor ? entriesRepo.encodeCursor(result.nextCursor) : null,
      };
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
      if (!assertAuthenticated(request, reply)) return;

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
        const settings = await generalSettingsRepo.get();
        const allowWeekendSelection = settings?.allowWeekendSelection ?? true;
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

      let targetUserId = request.user.id;
      if (userId) {
        const targetUserIdResult = requireNonEmptyString(userId, 'userId');
        if (!targetUserIdResult.ok) return badRequest(reply, targetUserIdResult.message);
        targetUserId = targetUserIdResult.value;

        if (
          targetUserId !== request.user.id &&
          !hasPermission(request, 'timesheets.tracker_all.view')
        ) {
          const allowed = await workUnitsRepo.isUserManagedBy(request.user.id, targetUserId);
          if (!allowed) {
            return reply
              .code(403)
              .send({ error: 'Not authorized to create entries for this user' });
          }
        }
      }

      const hourlyCost = await usersRepo.findCostPerHour(targetUserId);
      const resolvedTaskId = await tasksRepo.findIdByProjectAndName(
        projectIdResult.value,
        taskResult.value,
      );

      const created = await entriesRepo.create({
        id: generatePrefixedId('te'),
        userId: targetUserId,
        date: dateResult.value,
        clientId: clientIdResult.value,
        clientName: clientNameResult.value,
        projectId: projectIdResult.value,
        projectName: projectNameResult.value,
        task: taskResult.value,
        taskId: resolvedTaskId,
        notes: notes || null,
        duration: durationResult.value || 0,
        hourlyCost,
        isPlaceholder: isPlaceholderValue,
        location: location || 'remote',
      });

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
      if (!assertAuthenticated(request, reply)) return;

      const { id } = request.params as { id: string };
      const { duration, notes, isPlaceholder, location } = request.body as {
        duration?: number;
        notes?: string;
        isPlaceholder?: boolean;
        location?: string;
      };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      let parsedDuration = duration;
      if (duration !== undefined) {
        const durationResult = parseLocalizedNonNegativeNumber(duration, 'duration');
        if (!durationResult.ok) return badRequest(reply, durationResult.message);
        parsedDuration = durationResult.value;
      }

      if (notes !== undefined) {
        const notesResult = optionalNonEmptyString(notes, 'notes');
        if (!notesResult.ok) return badRequest(reply, notesResult.message);
      }

      const ownerId = await entriesRepo.findOwner(idResult.value);
      if (ownerId === null) {
        return reply.code(404).send({ error: 'Entry not found' });
      }

      if (ownerId !== request.user.id && !hasPermission(request, 'timesheets.tracker_all.view')) {
        const allowed = await workUnitsRepo.isUserManagedBy(request.user.id, ownerId);
        if (!allowed) {
          return reply.code(403).send({ error: 'Not authorized to update this entry' });
        }
      }

      const updated = await entriesRepo.update(idResult.value, {
        duration: parsedDuration,
        notes,
        isPlaceholder,
        location,
      });

      if (!updated) {
        return reply.code(404).send({ error: 'Entry not found' });
      }

      return updated;
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
      if (!assertAuthenticated(request, reply)) return;

      const { id } = request.params as { id: string };
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const ownerId = await entriesRepo.findOwner(idResult.value);
      if (ownerId === null) {
        return reply.code(404).send({ error: 'Entry not found' });
      }

      if (ownerId !== request.user.id && !hasPermission(request, 'timesheets.tracker_all.view')) {
        const allowed = await workUnitsRepo.isUserManagedBy(request.user.id, ownerId);
        if (!allowed) {
          return reply.code(403).send({ error: 'Not authorized to delete this entry' });
        }
      }

      await entriesRepo.deleteById(idResult.value);
      return { message: 'Entry deleted' };
    },
  );

  // DELETE / - Bulk delete entries (for recurring cleanup)
  fastify.delete(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requireAnyPermission('timesheets.tracker.delete', 'timesheets.recurring.delete'),
      ],
      schema: {
        tags: ['entries'],
        summary: 'Bulk delete time entries',
        querystring: entriesBulkDeleteQuerySchema,
        response: {
          200: messageResponseSchema,
          ...standardRateLimitedErrorResponses,
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

      const restrictToManagerScopeOf = hasPermission(request, 'timesheets.tracker_all.view')
        ? undefined
        : request.user.id;

      const deleted = await entriesRepo.bulkDelete({
        projectId: projectIdResult.value,
        task: taskResult.value,
        restrictToManagerScopeOf,
        fromDate: futureOnlyValue ? todayLocalDateOnly() : undefined,
        placeholderOnly: placeholderOnlyValue,
      });

      return { message: `Deleted ${deleted} entries` };
    },
  );
}
