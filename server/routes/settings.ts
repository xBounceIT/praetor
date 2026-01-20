import bcrypt from 'bcryptjs';
import { query } from '../db/index.ts';
import { authenticateToken } from '../middleware/auth.ts';
import { requireNonEmptyString, optionalNonEmptyString, optionalEmail, badRequest } from '../utils/validation.ts';

export default async function (fastify, opts) {
    // GET / - Get current user's settings
    fastify.get('/', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        const result = await query(
            `SELECT full_name, email
       FROM settings WHERE user_id = $1`,
            [request.user.id]
        );

        if (result.rows.length === 0) {
            // Create default settings if none exist
            const insertResult = await query(
                `INSERT INTO settings (user_id, full_name, email)
         VALUES ($1, $2, $3)
         RETURNING *`,
                [request.user.id, request.user.name, `${request.user.username}@example.com`]
            );

            const s = insertResult.rows[0];
            return {
                fullName: s.full_name,
                email: s.email
            };
        }

        const s = result.rows[0];
        return {
            fullName: s.full_name,
            email: s.email
        };
    });

    // PUT / - Update settings
    fastify.put('/', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        const { fullName, email } = request.body;
        const fullNameResult = optionalNonEmptyString(fullName, 'fullName');
        if (!fullNameResult.ok) return badRequest(reply, fullNameResult.message);

        const emailResult = optionalEmail(email, 'email');
        if (!emailResult.ok) return badRequest(reply, emailResult.message);

        const result = await query(
            `INSERT INTO settings (user_id, full_name, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         full_name = COALESCE($2, settings.full_name),
         email = COALESCE($3, settings.email),
         updated_at = CURRENT_TIMESTAMP
       RETURNING full_name, email`,
            [request.user.id, fullNameResult.value, emailResult.value]
        );

        const s = result.rows[0];
        return {
            fullName: s.full_name,
            email: s.email
        };
    });

    // PUT /password - Update user password
    fastify.put('/password', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        const { currentPassword, newPassword } = request.body;
        const currentPasswordResult = requireNonEmptyString(currentPassword, 'currentPassword');
        if (!currentPasswordResult.ok) return badRequest(reply, currentPasswordResult.message);

        const newPasswordResult = requireNonEmptyString(newPassword, 'newPassword');
        if (!newPasswordResult.ok) return badRequest(reply, newPasswordResult.message);

        if (newPasswordResult.value.length < 8) {
            return badRequest(reply, 'New password must be at least 8 characters long');
        }
        
        // Get user's current password hash
        const userRes = await query('SELECT password_hash FROM users WHERE id = $1', [request.user.id]);
        if (userRes.rows.length === 0) {
            return reply.code(404).send({ error: 'User not found' });
        }

        const { password_hash } = userRes.rows[0];

        const isMatch = await bcrypt.compare(currentPasswordResult.value, password_hash);
        if (!isMatch) {
            return badRequest(reply, 'Incorrect current password');
        }

        // Hash new password
        const newHash = await bcrypt.hash(newPasswordResult.value, 12);

        // Update password
        await query(
            'UPDATE users SET password_hash = $1 WHERE id = $2',
            [newHash, request.user.id]
        );

        return { message: 'Password updated successfully' };
    });
}
