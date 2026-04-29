import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as auditLogsRepo from '../repositories/auditLogsRepo.ts';
import { standardRateLimitedErrorResponses } from '../schemas/common.ts';

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
      const { startDate, endDate } = request.query as { startDate?: string; endDate?: string };

      return auditLogsRepo.list({ startDate, endDate });
    },
  );
}
