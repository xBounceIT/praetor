import bcrypt from 'bcryptjs';
import { query } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

export default async function (fastify, opts) {
    // GET / - Get current user's settings
    fastify.get('/', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        const result = await query(
            `SELECT full_name, email, daily_goal, start_of_week, treat_saturday_as_holiday, enable_ai_insights
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
                email: s.email,
                dailyGoal: parseFloat(s.daily_goal || 8),
                startOfWeek: s.start_of_week,
                treatSaturdayAsHoliday: s.treat_saturday_as_holiday,
                enableAiInsights: s.enable_ai_insights
            };
        }

        const s = result.rows[0];
        return {
            fullName: s.full_name,
            email: s.email,
            dailyGoal: parseFloat(s.daily_goal || 8),
            startOfWeek: s.start_of_week,
            treatSaturdayAsHoliday: s.treat_saturday_as_holiday,
            enableAiInsights: s.enable_ai_insights
        };
    });

    // PUT / - Update settings
    fastify.put('/', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        const { fullName, email, dailyGoal, startOfWeek, treatSaturdayAsHoliday, enableAiInsights } = request.body;

        const result = await query(
            `INSERT INTO settings (user_id, full_name, email, daily_goal, start_of_week, treat_saturday_as_holiday, enable_ai_insights)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
         full_name = COALESCE($2, settings.full_name),
         email = COALESCE($3, settings.email),
         daily_goal = COALESCE($4, settings.daily_goal),
         start_of_week = COALESCE($5, settings.start_of_week),
         treat_saturday_as_holiday = COALESCE($6, settings.treat_saturday_as_holiday),
         enable_ai_insights = COALESCE($7, settings.enable_ai_insights),
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
            [request.user.id, fullName, email, dailyGoal, startOfWeek, treatSaturdayAsHoliday, enableAiInsights]
        );

        const s = result.rows[0];
        return {
            fullName: s.full_name,
            email: s.email,
            dailyGoal: parseFloat(s.daily_goal || 8),
            startOfWeek: s.start_of_week,
            treatSaturdayAsHoliday: s.treat_saturday_as_holiday,
            enableAiInsights: s.enable_ai_insights
        };
    });

    // PUT /password - Update user password
    fastify.put('/password', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        const { currentPassword, newPassword } = request.body;

        if (!currentPassword || !newPassword) {
            return reply.code(400).send({ error: 'Current and new passwords are required' });
        }

        // Get user's current password hash
        const userRes = await query('SELECT password_hash FROM users WHERE id = $1', [request.user.id]);
        if (userRes.rows.length === 0) {
            return reply.code(404).send({ error: 'User not found' });
        }

        const { password_hash } = userRes.rows[0];

        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, password_hash);
        if (!isMatch) {
            return reply.code(400).send({ error: 'Incorrect current password' });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(12);
        const newHash = await bcrypt.hash(newPassword, salt);

        // Update password
        await query(
            'UPDATE users SET password_hash = $1 WHERE id = $2',
            [newHash, request.user.id]
        );

        return { message: 'Password updated successfully' };
    });
}
