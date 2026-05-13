import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  authenticateToken,
  requireAnyPermission,
  requireScopedPermission,
} from '../middleware/auth.ts';
import type { TimeEntry } from '../repositories/entriesRepo.ts';
import {
  messageResponseSchema,
  standardErrorResponses,
  standardRateLimitedErrorResponses,
} from '../schemas/common.ts';
import {
  bulkDeleteTimeEntries,
  createTimeEntry,
  deleteTimeEntry,
  listTimeEntries,
  TimeEntryServiceError,
  updateTimeEntry,
} from '../services/timeEntries.ts';
import { assertAuthenticated } from '../utils/auth-assert.ts';
import { requestHasPermission } from '../utils/permissions.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';

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
    cost: { type: 'number' },
    isPlaceholder: { type: 'boolean' },
    location: { type: 'string' },
    createdAt: { type: 'number' },
  },
  // `cost` and `hourlyCost` stay out of `required` because they are stripped at response
  // time when the caller lacks `reports.cost.view`. Everything else is always present.
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

const actorFromRequest = (request: FastifyRequest) => ({
  id: request.user?.id ?? '',
  permissions: request.user?.permissions ?? [],
});

// Strip `cost` / `hourlyCost` from outgoing entry payloads when the caller lacks
// `reports.cost.view`. Computed cost reveals per-user pay rates, so the API enforces the
// gate even when the UI happens to hide the column.
const sanitizeEntry = (entry: TimeEntry, includeCost: boolean): Partial<TimeEntry> => {
  if (includeCost) return entry;
  const { cost: _cost, hourlyCost: _hourlyCost, ...rest } = entry;
  return rest;
};

// `nextCursor` here is the already-encoded cursor string returned by the service
// (`listTimeEntries`), distinct from the raw `EntriesCursor` object exposed by the repo.
const sanitizeListResult = (
  result: { entries: TimeEntry[]; nextCursor: string | null },
  includeCost: boolean,
): { entries: Partial<TimeEntry>[]; nextCursor: string | null } => ({
  entries: result.entries.map((e) => sanitizeEntry(e, includeCost)),
  nextCursor: result.nextCursor,
});

const handleTimeEntryServiceError = (err: unknown, reply: FastifyReply) => {
  if (err instanceof TimeEntryServiceError) {
    return reply.code(err.statusCode).send({ error: err.message });
  }
  throw err;
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // GET / - List time entries
  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requireScopedPermission('timesheets.tracker', 'view'),
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
      try {
        const result = await listTimeEntries(actorFromRequest(request), {
          userId,
          limit,
          cursor,
        });
        return sanitizeListResult(result, requestHasPermission(request, 'reports.cost.view'));
      } catch (err) {
        return handleTimeEntryServiceError(err, reply);
      }
    },
  );

  // POST / - Create time entry
  fastify.post(
    '/',
    {
      onRequest: [authenticateToken, requireScopedPermission('timesheets.tracker', 'create')],
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

      try {
        const created = await createTimeEntry(actorFromRequest(request), request.body ?? {});
        return reply
          .code(201)
          .send(sanitizeEntry(created, requestHasPermission(request, 'reports.cost.view')));
      } catch (err) {
        return handleTimeEntryServiceError(err, reply);
      }
    },
  );

  // PUT /:id - Update time entry
  fastify.put(
    '/:id',
    {
      onRequest: [authenticateToken, requireScopedPermission('timesheets.tracker', 'update')],
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
      try {
        const updated = await updateTimeEntry(actorFromRequest(request), id, request.body ?? {});
        return sanitizeEntry(updated, requestHasPermission(request, 'reports.cost.view'));
      } catch (err) {
        return handleTimeEntryServiceError(err, reply);
      }
    },
  );

  // DELETE /:id - Delete time entry
  fastify.delete(
    '/:id',
    {
      onRequest: [authenticateToken, requireScopedPermission('timesheets.tracker', 'delete')],
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
      try {
        return await deleteTimeEntry(actorFromRequest(request), id);
      } catch (err) {
        return handleTimeEntryServiceError(err, reply);
      }
    },
  );

  // DELETE / - Bulk delete entries (for recurring cleanup)
  fastify.delete(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requireAnyPermission(
          'timesheets.tracker.delete',
          'timesheets.tracker_all.delete',
          'timesheets.recurring.delete',
        ),
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
      try {
        return await bulkDeleteTimeEntries(actorFromRequest(request), {
          projectId,
          task,
          futureOnly,
          placeholderOnly,
        });
      } catch (err) {
        return handleTimeEntryServiceError(err, reply);
      }
    },
  );
}
