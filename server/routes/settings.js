import express from 'express';
import { query } from '../db/index.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// GET /api/settings - Get current user's settings
router.get('/', authenticateToken, async (req, res, next) => {
    try {
        const result = await query(
            `SELECT full_name, email, start_of_week, 
               enable_ai_insights, compact_view, treat_saturday_as_holiday
       FROM settings WHERE user_id = $1`,
            [req.user.id]
        );

        if (result.rows.length === 0) {
            // Create default settings if none exist
            await query(
                `INSERT INTO settings (user_id, full_name, email)
         VALUES ($1, $2, $3)`,
                [req.user.id, req.user.name, `${req.user.username}@example.com`]
            );

            return res.json({
                fullName: req.user.name,
                email: `${req.user.username}@example.com`,
                startOfWeek: 'Monday',
                enableAiInsights: true,
                compactView: false,
                treatSaturdayAsHoliday: true
            });
        }

        const s = result.rows[0];
        res.json({
            fullName: s.full_name,
            email: s.email,
            startOfWeek: s.start_of_week,
            enableAiInsights: s.enable_ai_insights,
            compactView: s.compact_view,
            treatSaturdayAsHoliday: s.treat_saturday_as_holiday
        });
    } catch (err) {
        next(err);
    }
});

// PUT /api/settings - Update settings
router.put('/', authenticateToken, async (req, res, next) => {
    try {
        const { fullName, email, startOfWeek, enableAiInsights, compactView, treatSaturdayAsHoliday } = req.body;

        const result = await query(
            `INSERT INTO settings (user_id, full_name, email, start_of_week, enable_ai_insights, compact_view, treat_saturday_as_holiday)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
         full_name = COALESCE($2, settings.full_name),
         email = COALESCE($3, settings.email),
         start_of_week = COALESCE($4, settings.start_of_week),
         enable_ai_insights = COALESCE($5, settings.enable_ai_insights),
         compact_view = COALESCE($6, settings.compact_view),
         treat_saturday_as_holiday = COALESCE($7, settings.treat_saturday_as_holiday),
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
            [req.user.id, fullName, email, startOfWeek, enableAiInsights, compactView, treatSaturdayAsHoliday]
        );

        const s = result.rows[0];
        res.json({
            fullName: s.full_name,
            email: s.email,
            startOfWeek: s.start_of_week,
            enableAiInsights: s.enable_ai_insights,
            compactView: s.compact_view,
            treatSaturdayAsHoliday: s.treat_saturday_as_holiday
        });
    } catch (err) {
        next(err);
    }
});

export default router;
