import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requireRole } from '../middleware/auth.ts';
import {
  optionalNonEmptyString,
  optionalLocalizedNonNegativeNumber,
  parseBoolean,
  badRequest,
} from '../utils/validation.ts';

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // GET / - Get global settings (available to all authenticated users)
  fastify.get(
    '/',
    {
      onRequest: [authenticateToken],
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const result = await query(
        'SELECT currency, daily_limit, start_of_week, treat_saturday_as_holiday, enable_ai_insights, gemini_api_key, allow_weekend_selection, default_location FROM general_settings WHERE id = 1',
      );
      if (result.rows.length === 0) {
        return {
          currency: 'EUR',
          dailyLimit: 8.0,
          startOfWeek: 'Monday',
          treatSaturdayAsHoliday: true,
          enableAiInsights: false,
          geminiApiKey: '',
          allowWeekendSelection: true,
          defaultLocation: 'remote',
        };
      }
      const s = result.rows[0];
      // Only return API key to admins
      const geminiApiKey =
        request.user!.role === 'admin'
          ? s.gemini_api_key || ''
          : s.gemini_api_key
            ? '********'
            : '';

      return {
        currency: s.currency,
        dailyLimit: parseFloat(s.daily_limit),
        startOfWeek: s.start_of_week,
        treatSaturdayAsHoliday: s.treat_saturday_as_holiday,
        enableAiInsights: s.enable_ai_insights,
        geminiApiKey,
        allowWeekendSelection: s.allow_weekend_selection ?? true,
        defaultLocation: s.default_location || 'remote',
      };
    },
  );

  // PUT / - Update global settings (Admin only)
  fastify.put(
    '/',
    {
      onRequest: [authenticateToken, requireRole('admin')],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        currency,
        dailyLimit,
        startOfWeek,
        treatSaturdayAsHoliday,
        enableAiInsights,
        geminiApiKey,
        allowWeekendSelection,
        defaultLocation,
      } = request.body as {
        currency?: string;
        dailyLimit?: number;
        startOfWeek?: string;
        treatSaturdayAsHoliday?: boolean;
        enableAiInsights?: boolean;
        geminiApiKey?: string;
        allowWeekendSelection?: boolean;
        defaultLocation?: string;
      };
      const currencyResult = optionalNonEmptyString(currency, 'currency');
      if (!currencyResult.ok)
        return badRequest(reply, (currencyResult as { ok: false; message: string }).message);

      const dailyLimitResult = optionalLocalizedNonNegativeNumber(dailyLimit, 'dailyLimit');
      if (!dailyLimitResult.ok)
        return badRequest(reply, (dailyLimitResult as { ok: false; message: string }).message);

      const treatSaturdayAsHolidayValue = parseBoolean(treatSaturdayAsHoliday);
      const enableAiInsightsValue = parseBoolean(enableAiInsights);
      const allowWeekendSelectionValue = parseBoolean(allowWeekendSelection);

      const result = await query(
        `UPDATE general_settings
             SET currency = COALESCE($1, currency),
                 daily_limit = COALESCE($2, daily_limit),
                 start_of_week = COALESCE($3, start_of_week),
                 treat_saturday_as_holiday = COALESCE($4, treat_saturday_as_holiday),
                 enable_ai_insights = COALESCE($5, enable_ai_insights),
                 gemini_api_key = COALESCE($6, gemini_api_key),
                 allow_weekend_selection = COALESCE($7, allow_weekend_selection),
                 default_location = COALESCE($8, default_location),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = 1
             RETURNING currency, daily_limit, start_of_week, treat_saturday_as_holiday, enable_ai_insights, gemini_api_key, allow_weekend_selection, default_location`,
        [
          (currencyResult as { ok: true; value: string | null }).value,
          (dailyLimitResult as { ok: true; value: number | null }).value,
          startOfWeek,
          treatSaturdayAsHolidayValue,
          enableAiInsightsValue,
          geminiApiKey,
          allowWeekendSelectionValue,
          defaultLocation,
        ],
      );

      const s = result.rows[0];
      return {
        currency: s.currency,
        dailyLimit: parseFloat(s.daily_limit),
        startOfWeek: s.start_of_week,
        treatSaturdayAsHoliday: s.treat_saturday_as_holiday,
        enableAiInsights: s.enable_ai_insights,
        geminiApiKey: s.gemini_api_key || '',
        allowWeekendSelection: s.allow_weekend_selection ?? true,
        defaultLocation: s.default_location || 'remote',
      };
    },
  );
}
