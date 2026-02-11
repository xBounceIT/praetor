import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import { standardErrorResponses } from '../schemas/common.ts';

const auditLogSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    userName: { type: 'string' },
    username: { type: 'string' },
    ipAddress: { type: 'string' },
    createdAt: { type: 'number' },
  },
  required: ['id', 'userId', 'userName', 'username', 'ipAddress', 'createdAt'],
} as const;

const auditLogListSchema = {
  type: 'array',
  items: auditLogSchema,
} as const;

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.get(
    '/audit',
    {
      onRequest: [authenticateToken, requirePermission('administration.logs.view')],
      schema: {
        tags: ['logs'],
        summary: 'List system access audit logs',
        response: {
          200: auditLogListSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      const result = await query(
        `SELECT al.id, al.user_id, al.ip_address, al.created_at, u.name, u.username
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
        ipAddress: row.ip_address as string,
        createdAt: new Date(row.created_at as string).getTime(),
      }));
    },
  );
}
