import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withDbTransaction } from '../db/drizzle.ts';
import type { StoredRilDraftRows } from '../db/schema/rilDrafts.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as generalSettingsRepo from '../repositories/generalSettingsRepo.ts';
import * as rilDraftsRepo from '../repositories/rilDraftsRepo.ts';
import * as workUnitsRepo from '../repositories/workUnitsRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { notifyRilManualOvertimeForRows } from '../services/overtimeNotifications.ts';
import { assertAuthenticated } from '../utils/auth-assert.ts';
import { requestHasPermission } from '../utils/permissions.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { badRequest, forbidden } from '../utils/validation.ts';

const MONTH_KEY_PATTERN = '^[0-9]{4}-(0[1-9]|1[0-2])$';

// One RIL row keeps only the five user-editable fields; hours/PICAP are recomputed client-side.
const rilDraftRowSchema = {
  type: 'object',
  properties: {
    entrance: { type: 'string', maxLength: 16 },
    exit: { type: 'string', maxLength: 16 },
    notes: { type: 'string', maxLength: 64 },
    transfer: { type: 'string', maxLength: 64 },
    code: { type: 'string', maxLength: 16 },
  },
  required: ['entrance', 'exit', 'notes', 'transfer', 'code'],
  additionalProperties: false,
} as const;

// Body: object keyed by day-of-month (1..31). Reject any other key so a malformed payload can't
// bloat the row map past a single month.
const rilDraftRowsBodySchema = {
  type: 'object',
  maxProperties: 31,
  patternProperties: { '^([1-9]|[12][0-9]|3[01])$': rilDraftRowSchema },
  additionalProperties: false,
} as const;

const rilDraftResponseSchema = {
  type: 'object',
  properties: {
    monthKey: { type: 'string' },
    rows: { type: 'object', additionalProperties: rilDraftRowSchema },
    updatedAt: { type: ['string', 'null'] },
  },
  required: ['monthKey', 'rows', 'updatedAt'],
} as const;

const monthKeyParamsSchema = {
  type: 'object',
  properties: { monthKey: { type: 'string', pattern: MONTH_KEY_PATTERN } },
  required: ['monthKey'],
} as const;

const ownerQuerySchema = {
  type: 'object',
  properties: {
    userId: {
      type: 'string',
      description: 'RIL owner whose draft to read/write. Defaults to self.',
    },
  },
} as const;

const draftSaveBodySchema = {
  type: 'object',
  properties: {
    rows: rilDraftRowsBodySchema,
    changedDays: {
      type: 'array',
      items: { type: 'integer', minimum: 1, maximum: 31 },
      maxItems: 31,
      description: 'Days manually changed by the caller; used for RIL overtime notifications.',
    },
  },
  required: ['rows'],
} as const;

// Resolve the RIL-owner the actor is acting on, mirroring the time-entry cross-user rules: self is
// always allowed; another user needs the action-scoped `tracker_all` permission OR a manager link.
// `scopePermission` is the verb-specific all-scope (view for GET, update for PUT, delete for
// DELETE) so cross-user writes/deletes can't ride on a mere read-all grant — matching
// listTimeEntries/updateTimeEntry/deleteTimeEntry. Returns null after sending a 403.
const resolveOwnerId = async (
  request: FastifyRequest,
  reply: FastifyReply,
  actorId: string,
  rawUserId: unknown,
  scopePermission: string,
): Promise<string | null> => {
  const ownerId = typeof rawUserId === 'string' && rawUserId.trim() ? rawUserId.trim() : actorId;
  if (ownerId === actorId) return ownerId;
  if (requestHasPermission(request, scopePermission)) return ownerId;
  const managed = await workUnitsRepo.isUserManagedBy(actorId, ownerId);
  if (!managed) {
    forbidden(reply, 'Not authorized to access RIL drafts for this user');
    return null;
  }
  return ownerId;
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // GET /:monthKey - Fetch the saved draft for a month (empty shape when none exists)
  fastify.get(
    '/:monthKey',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requirePermission('timesheets.ril.view'),
      ],
      schema: {
        tags: ['ril'],
        summary: 'Get RIL draft for a month',
        params: monthKeyParamsSchema,
        querystring: ownerQuerySchema,
        response: {
          200: rilDraftResponseSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;
      const { monthKey } = request.params as { monthKey: string };
      const { userId } = request.query as { userId?: string };

      const ownerId = await resolveOwnerId(
        request,
        reply,
        request.user.id,
        userId,
        'timesheets.tracker_all.view',
      );
      if (ownerId === null) return;

      const draft = await rilDraftsRepo.getForUserMonth(ownerId, monthKey);
      return draft ?? { monthKey, rows: {}, updatedAt: null };
    },
  );

  // PUT /:monthKey - Replace the saved draft rows for a month
  fastify.put(
    '/:monthKey',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requirePermission('timesheets.ril.view'),
      ],
      schema: {
        tags: ['ril'],
        summary: 'Save RIL draft for a month',
        params: monthKeyParamsSchema,
        querystring: ownerQuerySchema,
        body: draftSaveBodySchema,
        response: {
          200: rilDraftResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;
      const { monthKey } = request.params as { monthKey: string };
      const { userId } = request.query as { userId?: string };
      const { rows, changedDays } = request.body as { rows?: unknown; changedDays?: unknown };
      if (rows === null || typeof rows !== 'object' || Array.isArray(rows)) {
        return badRequest(reply, 'rows must be an object keyed by day');
      }

      const ownerId = await resolveOwnerId(
        request,
        reply,
        request.user.id,
        userId,
        'timesheets.tracker_all.update',
      );
      if (ownerId === null) return;

      return withDbTransaction(async (tx) => {
        const saved = await rilDraftsRepo.upsertForUserMonth(
          ownerId,
          monthKey,
          rows as StoredRilDraftRows,
          tx,
        );
        const manualChangedDays = Array.isArray(changedDays) ? changedDays : [];
        if (manualChangedDays.length > 0) {
          const settings = await generalSettingsRepo.get(tx);
          await notifyRilManualOvertimeForRows(
            {
              userId: ownerId,
              monthKey,
              rows: rows as StoredRilDraftRows,
              changedDays: manualChangedDays,
              createdBy: request.user.id,
              lunchBreakMinutes: settings?.rilLunchBreakMinutes ?? undefined,
            },
            tx,
          );
        }
        return saved;
      });
    },
  );

  // DELETE /:monthKey - Discard the saved draft for a month
  fastify.delete(
    '/:monthKey',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requirePermission('timesheets.ril.view'),
      ],
      schema: {
        tags: ['ril'],
        summary: 'Delete RIL draft for a month',
        params: monthKeyParamsSchema,
        querystring: ownerQuerySchema,
        response: {
          204: { type: 'null' },
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;
      const { monthKey } = request.params as { monthKey: string };
      const { userId } = request.query as { userId?: string };

      const ownerId = await resolveOwnerId(
        request,
        reply,
        request.user.id,
        userId,
        'timesheets.tracker_all.delete',
      );
      if (ownerId === null) return;

      await rilDraftsRepo.deleteForUserMonth(ownerId, monthKey);
      return reply.code(204).send();
    },
  );
}
