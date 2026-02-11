import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db/index.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import { standardErrorResponses } from '../schemas/common.ts';
import {
  bumpNamespaceVersion,
  cacheGetSetJson,
  setCacheHeader,
  shouldBypassCache,
  TTL_SETTINGS_SECONDS,
} from '../services/cache.ts';
import {
  badRequest,
  optionalEnum,
  optionalLocalizedNonNegativeNumber,
  optionalNonEmptyString,
  parseBoolean,
} from '../utils/validation.ts';

const generalSettingsSchema = {
  type: 'object',
  properties: {
    currency: { type: 'string' },
    dailyLimit: { type: 'number' },
    startOfWeek: { type: 'string' },
    treatSaturdayAsHoliday: { type: 'boolean' },
    enableAiReporting: { type: 'boolean' },
    geminiApiKey: { type: 'string' },
    aiProvider: { type: 'string' },
    openrouterApiKey: { type: 'string' },
    geminiModelId: { type: 'string' },
    openrouterModelId: { type: 'string' },
    allowWeekendSelection: { type: 'boolean' },
    defaultLocation: { type: 'string' },
  },
  required: [
    'currency',
    'dailyLimit',
    'startOfWeek',
    'treatSaturdayAsHoliday',
    'enableAiReporting',
    'geminiApiKey',
    'aiProvider',
    'openrouterApiKey',
    'geminiModelId',
    'openrouterModelId',
    'allowWeekendSelection',
    'defaultLocation',
  ],
} as const;

const generalSettingsUpdateBodySchema = {
  type: 'object',
  properties: {
    currency: { type: 'string' },
    dailyLimit: { type: 'number' },
    startOfWeek: { type: 'string' },
    treatSaturdayAsHoliday: { type: 'boolean' },
    enableAiReporting: { type: 'boolean' },
    geminiApiKey: { type: 'string' },
    aiProvider: { type: 'string' },
    openrouterApiKey: { type: 'string' },
    geminiModelId: { type: 'string' },
    openrouterModelId: { type: 'string' },
    allowWeekendSelection: { type: 'boolean' },
    defaultLocation: { type: 'string' },
  },
} as const;

const hasPermission = (request: FastifyRequest, permission: string) =>
  request.user?.permissions?.includes(permission) ?? false;

export default async function (fastify: FastifyInstance, _opts: unknown) {
  // GET / - Get global settings (available to all authenticated users)
  fastify.get(
    '/',
    {
      onRequest: [authenticateToken],
      schema: {
        tags: ['general-settings'],
        summary: 'Get global settings',
        response: {
          200: generalSettingsSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const apiKeyVisible = hasPermission(request, 'administration.general.update') ? 'yes' : 'no';
      const bypass = shouldBypassCache(request);

      const { status, value } = await cacheGetSetJson(
        'general-settings',
        `v=4:apiKeyVisible=${apiKeyVisible}`,
        TTL_SETTINGS_SECONDS,
        async () => {
          const result = await query(
            'SELECT currency, daily_limit, start_of_week, treat_saturday_as_holiday, enable_ai_reporting, gemini_api_key, ai_provider, openrouter_api_key, gemini_model_id, openrouter_model_id, allow_weekend_selection, default_location FROM general_settings WHERE id = 1',
          );
          if (result.rows.length === 0) {
            return {
              currency: 'EUR',
              dailyLimit: 8.0,
              startOfWeek: 'Monday',
              treatSaturdayAsHoliday: true,
              enableAiReporting: false,
              geminiApiKey: '',
              aiProvider: 'gemini',
              openrouterApiKey: '',
              geminiModelId: '',
              openrouterModelId: '',
              allowWeekendSelection: true,
              defaultLocation: 'remote',
            };
          }
          const s = result.rows[0];
          const geminiApiKey =
            apiKeyVisible === 'yes' ? s.gemini_api_key || '' : s.gemini_api_key ? '********' : '';
          const openrouterApiKey =
            apiKeyVisible === 'yes'
              ? s.openrouter_api_key || ''
              : s.openrouter_api_key
                ? '********'
                : '';

          return {
            currency: s.currency,
            dailyLimit: parseFloat(s.daily_limit),
            startOfWeek: s.start_of_week,
            treatSaturdayAsHoliday: s.treat_saturday_as_holiday,
            enableAiReporting: s.enable_ai_reporting ?? false,
            geminiApiKey,
            aiProvider: s.ai_provider || 'gemini',
            openrouterApiKey,
            geminiModelId: s.gemini_model_id || '',
            openrouterModelId: s.openrouter_model_id || '',
            allowWeekendSelection: s.allow_weekend_selection ?? true,
            defaultLocation: s.default_location || 'remote',
          };
        },
        { bypass },
      );

      setCacheHeader(reply, status);
      return value;
    },
  );

  // PUT / - Update global settings (Admin only)
  fastify.put(
    '/',
    {
      onRequest: [authenticateToken, requirePermission('administration.general.update')],
      schema: {
        tags: ['general-settings'],
        summary: 'Update global settings',
        body: generalSettingsUpdateBodySchema,
        response: {
          200: generalSettingsSchema,
          ...standardErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const {
        currency,
        dailyLimit,
        startOfWeek,
        treatSaturdayAsHoliday,
        enableAiReporting,
        geminiApiKey,
        aiProvider,
        openrouterApiKey,
        geminiModelId,
        openrouterModelId,
        allowWeekendSelection,
        defaultLocation,
      } = request.body as {
        currency?: string;
        dailyLimit?: number;
        startOfWeek?: string;
        treatSaturdayAsHoliday?: boolean;
        enableAiReporting?: boolean;
        geminiApiKey?: string;
        aiProvider?: string;
        openrouterApiKey?: string;
        geminiModelId?: string;
        openrouterModelId?: string;
        allowWeekendSelection?: boolean;
        defaultLocation?: string;
      };
      const currencyResult = optionalNonEmptyString(currency, 'currency');
      if (!currencyResult.ok)
        return badRequest(reply, (currencyResult as { ok: false; message: string }).message);

      const dailyLimitResult = optionalLocalizedNonNegativeNumber(dailyLimit, 'dailyLimit');
      if (!dailyLimitResult.ok)
        return badRequest(reply, (dailyLimitResult as { ok: false; message: string }).message);

      const aiProviderResult = optionalEnum(aiProvider, ['gemini', 'openrouter'], 'aiProvider');
      if (!aiProviderResult.ok)
        return badRequest(reply, (aiProviderResult as { ok: false; message: string }).message);

      if (
        geminiModelId !== undefined &&
        geminiModelId !== null &&
        typeof geminiModelId !== 'string'
      )
        return badRequest(reply, 'geminiModelId must be a string');
      if (
        openrouterModelId !== undefined &&
        openrouterModelId !== null &&
        typeof openrouterModelId !== 'string'
      )
        return badRequest(reply, 'openrouterModelId must be a string');
      if (
        openrouterApiKey !== undefined &&
        openrouterApiKey !== null &&
        typeof openrouterApiKey !== 'string'
      )
        return badRequest(reply, 'openrouterApiKey must be a string');
      if (geminiApiKey !== undefined && geminiApiKey !== null && typeof geminiApiKey !== 'string')
        return badRequest(reply, 'geminiApiKey must be a string');

      const treatSaturdayAsHolidayValue = parseBoolean(treatSaturdayAsHoliday);
      const enableAiReportingValue = parseBoolean(enableAiReporting);
      const allowWeekendSelectionValue = parseBoolean(allowWeekendSelection);

      const result = await query(
        `UPDATE general_settings
             SET currency = COALESCE($1, currency),
                 daily_limit = COALESCE($2, daily_limit),
                 start_of_week = COALESCE($3, start_of_week),
                 treat_saturday_as_holiday = COALESCE($4, treat_saturday_as_holiday),
                 enable_ai_reporting = COALESCE($5, enable_ai_reporting),
                 gemini_api_key = COALESCE($6, gemini_api_key),
                 ai_provider = COALESCE($7, ai_provider),
                 openrouter_api_key = COALESCE($8, openrouter_api_key),
                 gemini_model_id = COALESCE($9, gemini_model_id),
                 openrouter_model_id = COALESCE($10, openrouter_model_id),
                 allow_weekend_selection = COALESCE($11, allow_weekend_selection),
                 default_location = COALESCE($12, default_location),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = 1
             RETURNING currency, daily_limit, start_of_week, treat_saturday_as_holiday, enable_ai_reporting, gemini_api_key, ai_provider, openrouter_api_key, gemini_model_id, openrouter_model_id, allow_weekend_selection, default_location`,
        [
          (currencyResult as { ok: true; value: string | null }).value,
          (dailyLimitResult as { ok: true; value: number | null }).value,
          startOfWeek,
          treatSaturdayAsHolidayValue,
          enableAiReportingValue,
          geminiApiKey,
          (aiProviderResult as { ok: true; value: string | null }).value,
          openrouterApiKey,
          geminiModelId,
          openrouterModelId,
          allowWeekendSelectionValue,
          defaultLocation,
        ],
      );

      const s = result.rows[0];
      await bumpNamespaceVersion('general-settings');
      return {
        currency: s.currency,
        dailyLimit: parseFloat(s.daily_limit),
        startOfWeek: s.start_of_week,
        treatSaturdayAsHoliday: s.treat_saturday_as_holiday,
        enableAiReporting: s.enable_ai_reporting ?? false,
        geminiApiKey: s.gemini_api_key || '',
        aiProvider: s.ai_provider || 'gemini',
        openrouterApiKey: s.openrouter_api_key || '',
        geminiModelId: s.gemini_model_id || '',
        openrouterModelId: s.openrouter_model_id || '',
        allowWeekendSelection: s.allow_weekend_selection ?? true,
        defaultLocation: s.default_location || 'remote',
      };
    },
  );
}
