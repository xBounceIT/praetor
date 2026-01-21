import { query } from '../db/index.ts';
import { authenticateToken, requireRole } from '../middleware/auth.ts';
import { optionalNonEmptyString, optionalLocalizedNonNegativeNumber, parseBoolean, badRequest } from '../utils/validation.ts';

export default async function (fastify, opts) {
    // GET / - Get global settings (available to all authenticated users)
    fastify.get('/', {
        onRequest: [authenticateToken]
    }, async (request, reply) => {
        const result = await query('SELECT currency, daily_limit, start_of_week, treat_saturday_as_holiday, enable_ai_insights, gemini_api_key FROM general_settings WHERE id = 1');
        if (result.rows.length === 0) {
            return {
                currency: 'USD',
                dailyLimit: 8.00,
                startOfWeek: 'Monday',
                treatSaturdayAsHoliday: true,
                enableAiInsights: false,
                geminiApiKey: ''
            };
        }
        const s = result.rows[0];
        // Only return API key to admins
        const geminiApiKey = request.user.role === 'admin' ? (s.gemini_api_key || '') : (s.gemini_api_key ? '********' : '');

        return {
            currency: s.currency,
            dailyLimit: parseFloat(s.daily_limit),
            startOfWeek: s.start_of_week,
            treatSaturdayAsHoliday: s.treat_saturday_as_holiday,
            enableAiInsights: s.enable_ai_insights,
            geminiApiKey
        };
    });

    // PUT / - Update global settings (Admin only)
    fastify.put('/', {
        onRequest: [authenticateToken, requireRole('admin')]
    }, async (request, reply) => {
        const { currency, dailyLimit, startOfWeek, treatSaturdayAsHoliday, enableAiInsights, geminiApiKey } = request.body;
        const currencyResult = optionalNonEmptyString(currency, 'currency');
        if (!currencyResult.ok) return badRequest(reply, currencyResult.message);

        const dailyLimitResult = optionalLocalizedNonNegativeNumber(dailyLimit, 'dailyLimit');
        if (!dailyLimitResult.ok) return badRequest(reply, dailyLimitResult.message);

        const treatSaturdayAsHolidayValue = parseBoolean(treatSaturdayAsHoliday);
        const enableAiInsightsValue = parseBoolean(enableAiInsights);

        const result = await query(
            `UPDATE general_settings 
             SET currency = COALESCE($1, currency),
                 daily_limit = COALESCE($2, daily_limit),
                 start_of_week = COALESCE($3, start_of_week),
                 treat_saturday_as_holiday = COALESCE($4, treat_saturday_as_holiday),
                 enable_ai_insights = COALESCE($5, enable_ai_insights),
                 gemini_api_key = COALESCE($6, gemini_api_key),
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = 1 
             RETURNING currency, daily_limit, start_of_week, treat_saturday_as_holiday, enable_ai_insights, gemini_api_key`,
            [currencyResult.value, dailyLimitResult.value, startOfWeek, treatSaturdayAsHolidayValue, enableAiInsightsValue, geminiApiKey]
        );

        const s = result.rows[0];
        return {
            currency: s.currency,
            dailyLimit: parseFloat(s.daily_limit),
            startOfWeek: s.start_of_week,
            treatSaturdayAsHoliday: s.treat_saturday_as_holiday,
            enableAiInsights: s.enable_ai_insights,
            geminiApiKey: s.gemini_api_key || ''
        };
    });
}
