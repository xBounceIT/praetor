import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  authenticateToken,
  requireAnyPermission,
  requirePermission,
  requireScopedPermission,
} from '../middleware/auth.ts';
import type { TimeEntry } from '../repositories/entriesRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import {
  bulkDeleteTimeEntries,
  createTimeEntry,
  deleteTimeEntry,
  generateRecurringEntries,
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
    version: { type: 'integer', minimum: 1 },
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
    'version',
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
  // Display names (clientName, projectName) are derived server-side from the IDs and
  // intentionally not part of the update wire format — see `updateTimeEntry`.
  properties: {
    date: { type: 'string', format: 'date' },
    clientId: { type: 'string' },
    projectId: { type: 'string' },
    task: { type: 'string' },
    duration: { type: 'number' },
    notes: { type: ['string', 'null'] },
    isPlaceholder: { type: 'boolean' },
    location: { type: 'string' },
    version: { type: 'integer', minimum: 1 },
  },
  required: ['version'],
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

const recurringGenerateBodySchema = {
  type: 'object',
  properties: {
    fromDate: { type: 'string', format: 'date' },
    toDate: { type: 'string', format: 'date' },
    userId: { type: 'string' },
  },
  required: ['fromDate', 'toDate'],
} as const;

const recurringGenerateResponseSchema = {
  type: 'object',
  properties: {
    generated: { type: 'array', items: entrySchema },
    generatedCount: { type: 'integer' },
    skippedExistingCount: { type: 'integer' },
    range: {
      type: 'object',
      properties: {
        fromDate: { type: 'string', format: 'date' },
        toDate: { type: 'string', format: 'date' },
      },
      required: ['fromDate', 'toDate'],
    },
  },
  required: ['generated', 'generatedCount', 'skippedExistingCount', 'range'],
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

type SanitizedEntry = TimeEntry | Omit<TimeEntry, 'cost' | 'hourlyCost'>;

// Strip `cost` / `hourlyCost` from outgoing entry payloads when the caller lacks
// `reports.cost.view`. Computed cost reveals per-user pay rates, so the API enforces the
// gate even when the UI happens to hide the column.
const sanitizeEntry = (entry: TimeEntry, includeCost: boolean): SanitizedEntry => {
  if (includeCost) return entry;
  const { cost: _cost, hourlyCost: _hourlyCost, ...rest } = entry;
  return rest;
};

const sanitizeListResult = (
  result: { entries: TimeEntry[]; nextCursor: string | null },
  includeCost: boolean,
): { entries: SanitizedEntry[]; nextCursor: string | null } => ({
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
          204: { type: 'null' },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;

      const { id } = request.params as { id: string };
      try {
        // Service still returns `{ message }` because the MCP tool surface relays it back to
        // the client; the REST route discards it and returns 204-no-body per REST norms.
        await deleteTimeEntry(actorFromRequest(request), id);
        return reply.code(204).send();
      } catch (err) {
        return handleTimeEntryServiceError(err, reply);
      }
    },
  );

  // POST /recurring/generate - Materialize recurring templates into time entries
  fastify.post(
    '/recurring/generate',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requirePermission('timesheets.recurring.create'),
      ],
      schema: {
        tags: ['entries'],
        summary: 'Generate time entries from recurring templates',
        description:
          'Walks the active recurring task templates assigned to the target user (or the ' +
          'authenticated user if `userId` is omitted) and inserts a placeholder time entry ' +
          'for every matching day in `[fromDate, toDate]` that does not already have an ' +
          'entry for the same (date, project, task) tuple. Idempotent.',
        body: recurringGenerateBodySchema,
        response: {
          200: recurringGenerateResponseSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;

      try {
        return await generateRecurringEntries(actorFromRequest(request), request.body ?? {});
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
        description:
          'Deletes entries matching `projectId` and `task`. Callers with only ' +
          '`timesheets.recurring.delete` are limited to placeholder entries, even if ' +
          '`placeholderOnly=false` is supplied; tracker delete permissions can delete all ' +
          'matching entries allowed by their scope.',
        querystring: entriesBulkDeleteQuerySchema,
        response: {
          204: { type: 'null' },
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
        await bulkDeleteTimeEntries(actorFromRequest(request), {
          projectId,
          task,
          futureOnly,
          placeholderOnly,
        });
        return reply.code(204).send();
      } catch (err) {
        return handleTimeEntryServiceError(err, reply);
      }
    },
  );
}
