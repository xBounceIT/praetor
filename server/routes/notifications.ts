import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken } from '../middleware/auth.ts';
import { requireNonEmptyString, badRequest } from '../utils/validation.ts';

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // All notifications routes require authentication
  fastify.addHook('onRequest', authenticateToken);

  // GET / - Fetch notifications for current user
  fastify.get('/', async (request: FastifyRequest, _reply: FastifyReply) => {
    const userId = request.user!.id;

    const result = await query(
      `SELECT 
        id,
        user_id as "userId",
        type,
        title,
        message,
        data,
        is_read as "isRead",
        EXTRACT(EPOCH FROM created_at) * 1000 as "createdAt"
      FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 50`,
      [userId],
    );

    // Get unread count
    const countResult = await query(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = FALSE`,
      [userId],
    );

    return {
      notifications: result.rows,
      unreadCount: parseInt(countResult.rows[0].count, 10),
    };
  });

  // PUT /:id/read - Mark single notification as read
  fastify.put('/:id/read', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.id;

    const idResult = requireNonEmptyString(id, 'id');
    if (!idResult.ok) return badRequest(reply, idResult.message);

    const result = await query(
      `UPDATE notifications 
       SET is_read = TRUE 
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [idResult.value, userId],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Notification not found' });
    }

    return { success: true };
  });

  // PUT /read-all - Mark all notifications as read
  fastify.put('/read-all', async (request: FastifyRequest, _reply: FastifyReply) => {
    const userId = request.user!.id;

    await query(`UPDATE notifications SET is_read = TRUE WHERE user_id = $1`, [userId]);

    return { success: true };
  });

  // DELETE /:id - Delete a notification
  fastify.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.id;

    const idResult = requireNonEmptyString(id, 'id');
    if (!idResult.ok) return badRequest(reply, idResult.message);

    const result = await query(
      `DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id`,
      [idResult.value, userId],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Notification not found' });
    }

    return reply.code(204).send();
  });
}
