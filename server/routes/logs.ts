import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as auditLogsRepo from '../repositories/auditLogsRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
import { standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { AUDIT_ENTITY_TYPES } from '../utils/audit.ts';

const auditLogDetailsSchema = {
  type: 'object',
  properties: {
    targetLabel: { type: 'string' },
    secondaryLabel: { type: 'string' },
    changedFields: { type: 'array', items: { type: 'string' } },
    counts: { type: 'object', additionalProperties: { type: 'number' } },
    fromValue: { type: 'string' },
    toValue: { type: 'string' },
  },
  additionalProperties: false,
} as const;

const auditLogSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    userName: { type: 'string' },
    username: { type: 'string' },
    action: { type: 'string' },
    entityType: { type: ['string', 'null'] },
    entityId: { type: ['string', 'null'] },
    ipAddress: { type: 'string' },
    createdAt: { type: 'number' },
    details: { anyOf: [auditLogDetailsSchema, { type: 'null' }] },
  },
  required: ['id', 'userId', 'userName', 'username', 'action', 'ipAddress', 'createdAt'],
} as const;

const auditLogListSchema = {
  type: 'array',
  items: auditLogSchema,
} as const;

const auditLogQuerySchema = {
  type: 'object',
  properties: {
    startDate: { type: 'string', format: 'date-time' },
    endDate: { type: 'string', format: 'date-time' },
    userId: { type: 'string', maxLength: 50 },
    username: { type: 'string', maxLength: 255 },
    action: { type: 'string', maxLength: 100 },
    entityType: { type: 'string', enum: AUDIT_ENTITY_TYPES },
  },
} as const;

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.get(
    '/audit',
    {
      onRequest: [authenticateToken, requirePermission('administration.logs.view')],
      schema: {
        tags: ['logs'],
        summary: 'List system audit logs',
        querystring: auditLogQuerySchema,
        response: {
          200: auditLogListSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { startDate, endDate, userId, username, action, entityType } = request.query as {
        startDate?: string;
        endDate?: string;
        userId?: string;
        username?: string;
        action?: string;
        entityType?: string;
      };

      // Resolve `username` → `userId` so the repo can stay strictly typed on userId.
      // A username that doesn't resolve to a user short-circuits to an empty result set
      // (we pass a sentinel that won't match any row) so the API does not silently return
      // unrelated rows when the lookup fails.
      let resolvedUserId = userId;
      if (username && !resolvedUserId) {
        const user = await usersRepo.findLoginUserByNormalizedUsername(username);
        if (!user) {
          return [];
        }
        resolvedUserId = user.id;
      }

      return auditLogsRepo.list({
        startDate,
        endDate,
        userId: resolvedUserId,
        action,
        entityType,
      });
    },
  );
}
