import type { FastifyInstance } from 'fastify';
import type { DbExecutor } from '../db/drizzle.ts';
import { withDbTransaction } from '../db/drizzle.ts';
import { requirePermission } from '../middleware/auth.ts';
import type { RevisionRow, RevisionTitleUpdate } from '../repositories/revisionsRepo.ts';
import { standardErrorResponses, standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { RevisionRestoreConflict } from '../services/revisionRestore.ts';
import { logAudit } from '../utils/audit.ts';
import type { Permission } from '../utils/permissions.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { replyError } from '../utils/replyError.ts';
import { parseRevisionTitle, REVISION_TITLE_MAX_LENGTH } from '../utils/revision-titles.ts';
import { badRequest, requireNonEmptyString } from '../utils/validation.ts';

const revisionRowSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    revisionNumber: { type: 'integer' },
    revisionCode: { type: 'string' },
    title: { type: ['string', 'null'] },
    createdByUserId: { type: ['string', 'null'] },
    createdByUserName: { type: ['string', 'null'] },
    createdAt: { type: 'number' },
  },
  required: ['id', 'revisionNumber', 'revisionCode', 'title', 'createdAt'],
} as const;

const revisionSchema = {
  ...revisionRowSchema,
  properties: {
    ...revisionRowSchema.properties,
    snapshot: { type: 'object', additionalProperties: true },
  },
  required: [...revisionRowSchema.required, 'snapshot'],
} as const;

const revisionTitleUpdateSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: ['string', 'null'] },
  },
  required: ['id', 'title'],
} as const;

type RevisionWithSnapshot = RevisionRow & { snapshot: unknown };

export const registerRevisionHistoryRoutes = <
  TResult,
  TRevision extends RevisionWithSnapshot = RevisionWithSnapshot,
>(
  fastify: FastifyInstance,
  options: {
    entityType: 'client_quote' | 'client_offer' | 'supplier_quote';
    viewPermission: Permission;
    updatePermission: Permission;
    list: (objectId: string) => Promise<RevisionRow[]>;
    exists: (objectId: string, exec?: DbExecutor) => Promise<boolean>;
    find: (objectId: string, revisionId: string, exec?: DbExecutor) => Promise<TRevision | null>;
    updateTitle: (
      objectId: string,
      revisionId: string,
      title: string | null,
      exec?: DbExecutor,
    ) => Promise<RevisionTitleUpdate | null>;
    restore: (
      objectId: string,
      revision: TRevision,
      createdByUserId: string | null,
      tx: DbExecutor,
    ) => Promise<TResult | null>;
    responseSchema: object;
  },
) => {
  fastify.get(
    '/:id/revisions',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission(options.viewPermission),
      ],
      schema: {
        summary: `List ${options.entityType} revisions`,
        response: {
          200: { type: 'array', items: revisionRowSchema },
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = requireNonEmptyString(id, 'id');
      if (!parsed.ok) return badRequest(reply, parsed.message);
      if (!(await options.exists(parsed.value))) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Document not found',
          action: `${options.entityType}.revision_list.not_found`,
          entityType: options.entityType,
          entityId: parsed.value,
        });
      }
      return options.list(parsed.value);
    },
  );

  fastify.get(
    '/:id/revisions/:revisionId',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission(options.viewPermission),
      ],
      schema: {
        summary: `Get a ${options.entityType} revision`,
        response: { 200: revisionSchema, ...standardRateLimitedErrorResponses },
      },
    },
    async (request, reply) => {
      const { id, revisionId } = request.params as { id: string; revisionId: string };
      const revision = await options.find(id, revisionId);
      if (!revision) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Revision not found',
          action: `${options.entityType}.revision_get.not_found`,
          entityType: options.entityType,
          entityId: id,
        });
      }
      return revision;
    },
  );

  fastify.patch(
    '/:id/revisions/:revisionId',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission(options.updatePermission),
      ],
      schema: {
        summary: `Update a ${options.entityType} revision title`,
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: ['string', 'null'], maxLength: REVISION_TITLE_MAX_LENGTH },
          },
          required: ['title'],
        },
        response: { 200: revisionTitleUpdateSchema, ...standardErrorResponses },
      },
    },
    async (request, reply) => {
      const { id, revisionId } = request.params as { id: string; revisionId: string };
      const objectIdResult = requireNonEmptyString(id, 'id');
      if (!objectIdResult.ok) return badRequest(reply, objectIdResult.message);
      const revisionIdResult = requireNonEmptyString(revisionId, 'revisionId');
      if (!revisionIdResult.ok) return badRequest(reply, revisionIdResult.message);
      const titleResult = parseRevisionTitle((request.body as { title?: unknown }).title, 'title');
      if (!titleResult.ok) return badRequest(reply, titleResult.message);

      const updated = await options.updateTitle(
        objectIdResult.value,
        revisionIdResult.value,
        titleResult.value,
      );
      if (!updated) {
        return replyError(request, reply, {
          statusCode: 404,
          message: 'Revision not found',
          action: `${options.entityType}.revision_title_update.not_found`,
          entityType: options.entityType,
          entityId: objectIdResult.value,
        });
      }

      await logAudit({
        request,
        action: `${options.entityType}.revision.title_updated`,
        entityType: options.entityType,
        entityId: objectIdResult.value,
        details: { secondaryLabel: revisionIdResult.value },
      });
      return updated;
    },
  );

  fastify.post(
    '/:id/revisions/:revisionId/restore',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission(options.updatePermission),
      ],
      schema: {
        summary: `Restore a ${options.entityType} revision into draft`,
        response: { 200: options.responseSchema, ...standardErrorResponses },
      },
    },
    async (request, reply) => {
      const { id, revisionId } = request.params as { id: string; revisionId: string };
      try {
        const result = await withDbTransaction(async (tx) => {
          const revision = await options.find(id, revisionId, tx);
          if (!revision) return null;
          return options.restore(id, revision, request.user?.id ?? null, tx);
        });
        if (!result) {
          return replyError(request, reply, {
            statusCode: 404,
            message: 'Revision or document not found',
            action: `${options.entityType}.revision_restore.not_found`,
            entityType: options.entityType,
            entityId: id,
          });
        }
        await logAudit({
          request,
          action: `${options.entityType}.revision.restored`,
          entityType: options.entityType,
          entityId: id,
          details: { secondaryLabel: revisionId },
        });
        return result;
      } catch (error) {
        if (error instanceof RevisionRestoreConflict) {
          return replyError(request, reply, {
            statusCode: 409,
            message: error.message,
            action: `${options.entityType}.revision_restore.conflict`,
            entityType: options.entityType,
            entityId: id,
            details: { secondaryLabel: error.secondaryLabel },
          });
        }
        throw error;
      }
    },
  );
};
