import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as notificationsRepo from '../repositories/notificationsRepo.ts';
import {
  standardErrorResponses,
  standardRateLimitedErrorResponses,
  successResponseSchema,
} from '../schemas/common.ts';
import { assertAuthenticated } from '../utils/auth-assert.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import { badRequest, requireNonEmptyString } from '../utils/validation.ts';

const idParamSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;

const notificationSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    type: { type: 'string' },
    title: { type: 'string' },
    message: { type: 'string' },
    data: { type: ['object', 'null'], additionalProperties: true },
    isRead: { type: 'boolean' },
    createdAt: { type: 'number' },
  },
  required: ['id', 'userId', 'type', 'title', 'message', 'isRead', 'createdAt'],
} as const;

const notificationsResponseSchema = {
  type: 'object',
  properties: {
    notifications: { type: 'array', items: notificationSchema },
    unreadCount: { type: 'number' },
  },
  required: ['notifications', 'unreadCount'],
} as const;

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // All notifications routes require authentication
  fastify.addHook('onRequest', authenticateToken);

  // GET / - Fetch notifications for current user
  fastify.get(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        requirePermission('notifications.view'),
      ],
      schema: {
        tags: ['notifications'],
        summary: 'Fetch notifications',
        response: {
          200: notificationsResponseSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;
      const userId = request.user.id;

      const [notifications, unreadCount] = await Promise.all([
        notificationsRepo.listForUser(userId),
        notificationsRepo.countUnreadForUser(userId),
      ]);

      return { notifications, unreadCount };
    },
  );

  // PUT /:id/read - Mark single notification as read
  fastify.put(
    '/:id/read',
    {
      onRequest: [requirePermission('notifications.update')],
      schema: {
        tags: ['notifications'],
        summary: 'Mark notification as read',
        params: idParamSchema,
        response: {
          200: successResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;
      const { id } = request.params as { id: string };

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const found = await notificationsRepo.markReadForUser(idResult.value, request.user.id);

      if (!found) {
        return reply.code(404).send({ error: 'Notification not found' });
      }

      return { success: true };
    },
  );

  // PUT /read-all - Mark all notifications as read
  fastify.put(
    '/read-all',
    {
      onRequest: [requirePermission('notifications.update')],
      schema: {
        tags: ['notifications'],
        summary: 'Mark all notifications as read',
        response: {
          200: successResponseSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!assertAuthenticated(request, reply)) return;

      await notificationsRepo.markAllReadForUser(request.user.id);

      return { success: true };
    },
  );

  // DELETE /:id - Delete a notification
  fastify.delete(
    '/:id',
    {
      onRequest: [requirePermission('notifications.delete')],
      schema: {
        tags: ['notifications'],
        summary: 'Delete notification',
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

      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const found = await notificationsRepo.deleteForUser(idResult.value, request.user.id);

      if (!found) {
        return reply.code(404).send({ error: 'Notification not found' });
      }

      return reply.code(204).send();
    },
  );
}
