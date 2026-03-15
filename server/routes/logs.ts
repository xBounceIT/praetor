import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
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

const parseAuditLogDetails = (value: unknown) => {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  return typeof value === 'object' ? (value as Record<string, unknown>) : null;
};

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.get(
    '/audit',
    {
      onRequest: [authenticateToken, requirePermission('administration.logs.view')],
      schema: {
        tags: ['logs'],
        summary: 'List system audit logs',
        response: {
          200: auditLogListSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      const result = await query(
        `SELECT al.id, al.user_id, al.action, al.entity_type, al.entity_id, al.ip_address, al.created_at, al.details, u.name, u.username
         FROM audit_logs al
         JOIN users u ON u.id = al.user_id
         ORDER BY al.created_at DESC
         LIMIT 500`,
      );

      return result.rows.map((row) => ({
        id: row.id as string,
        userId: row.user_id as string,
        userName: row.name as string,
        username: row.username as string,
        action: row.action as string,
        entityType: (row.entity_type as string) ?? null,
        entityId: (row.entity_id as string) ?? null,
        ipAddress: row.ip_address as string,
        createdAt: new Date(row.created_at as string).getTime(),
        details: parseAuditLogDetails(row.details),
      }));
    },
  );
}
