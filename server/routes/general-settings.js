import express from 'express';
import { query } from '../db/index.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/general-settings - Get global settings (available to all authenticated users)
router.get('/', authenticateToken, async (req, res, next) => {
    try {
        const result = await query('SELECT currency, daily_limit FROM general_settings WHERE id = 1');
        if (result.rows.length === 0) {
            return res.json({ currency: 'USD', dailyLimit: 8.00 });
        }
        res.json({
            currency: result.rows[0].currency,
            dailyLimit: parseFloat(result.rows[0].daily_limit)
        });
    } catch (err) {
        next(err);
    }
});

// PUT /api/general-settings - Update global settings (Admin only)
router.put('/', authenticateToken, requireRole('admin'), async (req, res, next) => {
    try {
        const { currency, dailyLimit } = req.body;

        const result = await query(
            `UPDATE general_settings 
             SET currency = COALESCE($1, currency),
                 daily_limit = COALESCE($2, daily_limit),
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = 1 
             RETURNING currency, daily_limit`,
            [currency, dailyLimit]
        );

        res.json({
            currency: result.rows[0].currency,
            dailyLimit: parseFloat(result.rows[0].daily_limit)
        });
    } catch (err) {
        next(err);
    }
});

export default router;
