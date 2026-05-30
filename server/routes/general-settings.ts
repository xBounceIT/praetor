import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as generalSettingsRepo from '../repositories/generalSettingsRepo.ts';
import { standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { VALID_LOCATIONS } from '../services/timeEntries.ts';
import { logAudit } from '../utils/audit.ts';
import { MASKED_SECRET } from '../utils/crypto.ts';
import { requestHasPermission as hasPermission } from '../utils/permissions.ts';
import { STANDARD_ROUTE_RATE_LIMIT } from '../utils/rate-limit.ts';
import {
  badRequest,
  optionalEnum,
  optionalLocalizedNonNegativeNumber,
  optionalNonEmptyString,
  parseBooleanField,
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
    rilCompanyName: { type: 'string', maxLength: 255 },
    rilDefaultStartTime: { type: 'string' },
    rilLunchBreakMinutes: { type: 'integer' },
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
    'rilCompanyName',
    'rilDefaultStartTime',
    'rilLunchBreakMinutes',
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
    rilCompanyName: { type: 'string', maxLength: 255 },
    rilDefaultStartTime: { type: 'string' },
    rilLunchBreakMinutes: { type: 'integer' },
  },
} as const;

const DEFAULT_SETTINGS: generalSettingsRepo.GeneralSettings = {
  currency: 'EUR',
  dailyLimit: 8.0,
  startOfWeek: 'Monday',
  treatSaturdayAsHoliday: true,
  enableAiReporting: false,
  geminiApiKey: null,
  aiProvider: 'gemini',
  openrouterApiKey: null,
  geminiModelId: null,
  openrouterModelId: null,
  allowWeekendSelection: true,
  defaultLocation: 'remote',
  rilCompanyName: '',
  rilDefaultStartTime: '09:00',
  rilLunchBreakMinutes: 60,
};

const maskApiKey = (value: string | null, reveal: boolean) =>
  reveal ? (value ?? '') : value ? MASKED_SECRET : '';

const TIME_OF_DAY_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

const validateOptionalTimeOfDay = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null || value === '') {
    return { ok: true as const, value: null };
  }
  if (typeof value !== 'string' || !TIME_OF_DAY_PATTERN.test(value.trim())) {
    return { ok: false as const, message: `${fieldName} must be in HH:mm format` };
  }
  return { ok: true as const, value: value.trim() };
};

const validateOptionalString = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null) {
    return { ok: true as const, value: null };
  }
  if (typeof value !== 'string') {
    return { ok: false as const, message: `${fieldName} must be a string` };
  }
  const trimmed = value.trim();
  if (trimmed.length > 255) {
    return { ok: false as const, message: `${fieldName} must be 255 characters or fewer` };
  }
  return { ok: true as const, value: trimmed };
};

const validateOptionalLunchBreakMinutes = (value: unknown) => {
  if (value === undefined || value === null || value === '') {
    return { ok: true as const, value: null };
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 240) {
    return {
      ok: false as const,
      message: 'rilLunchBreakMinutes must be an integer between 0 and 240',
    };
  }
  return { ok: true as const, value };
};

const toResponse = (settings: generalSettingsRepo.GeneralSettings, revealApiKeys: boolean) => ({
  currency: settings.currency,
  dailyLimit: settings.dailyLimit,
  startOfWeek: settings.startOfWeek,
  treatSaturdayAsHoliday: settings.treatSaturdayAsHoliday,
  enableAiReporting: settings.enableAiReporting ?? false,
  geminiApiKey: maskApiKey(settings.geminiApiKey, revealApiKeys),
  aiProvider: settings.aiProvider || 'gemini',
  openrouterApiKey: maskApiKey(settings.openrouterApiKey, revealApiKeys),
  geminiModelId: settings.geminiModelId || '',
  openrouterModelId: settings.openrouterModelId || '',
  allowWeekendSelection: settings.allowWeekendSelection ?? true,
  defaultLocation: settings.defaultLocation || 'remote',
  rilCompanyName: settings.rilCompanyName ?? '',
  rilDefaultStartTime: settings.rilDefaultStartTime || '09:00',
  rilLunchBreakMinutes: settings.rilLunchBreakMinutes ?? 60,
});

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.get(
    '/',
    {
      onRequest: [fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT), authenticateToken],
      schema: {
        tags: ['general-settings'],
        summary: 'Get global settings',
        response: {
          200: generalSettingsSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const settings = await generalSettingsRepo.get();
      return toResponse(
        settings ?? DEFAULT_SETTINGS,
        hasPermission(request, 'administration.general.update'),
      );
    },
  );

  fastify.put(
    '/',
    {
      onRequest: [
        fastify.rateLimit(STANDARD_ROUTE_RATE_LIMIT),
        authenticateToken,
        requirePermission('administration.general.update'),
      ],
      schema: {
        tags: ['general-settings'],
        summary: 'Update global settings',
        body: generalSettingsUpdateBodySchema,
        response: {
          200: generalSettingsSchema,
          ...standardRateLimitedErrorResponses,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as {
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
        rilCompanyName?: string;
        rilDefaultStartTime?: string;
        rilLunchBreakMinutes?: number;
      };
      const {
        currency,
        dailyLimit,
        startOfWeek,
        geminiApiKey,
        aiProvider,
        openrouterApiKey,
        geminiModelId,
        openrouterModelId,
        defaultLocation,
        rilCompanyName,
        rilDefaultStartTime,
        rilLunchBreakMinutes,
      } = body;
      const currencyResult = optionalNonEmptyString(currency, 'currency');
      if (!currencyResult.ok) return badRequest(reply, currencyResult.message);

      const dailyLimitResult = optionalLocalizedNonNegativeNumber(dailyLimit, 'dailyLimit');
      if (!dailyLimitResult.ok) return badRequest(reply, dailyLimitResult.message);

      const aiProviderResult = optionalEnum(aiProvider, ['gemini', 'openrouter'], 'aiProvider');
      if (!aiProviderResult.ok) return badRequest(reply, aiProviderResult.message);

      const startOfWeekResult = optionalEnum(startOfWeek, ['Monday', 'Sunday'], 'startOfWeek');
      if (!startOfWeekResult.ok) return badRequest(reply, startOfWeekResult.message);

      const defaultLocationResult = optionalEnum(
        defaultLocation,
        VALID_LOCATIONS,
        'defaultLocation',
      );
      if (!defaultLocationResult.ok) return badRequest(reply, defaultLocationResult.message);

      const rilCompanyNameResult = validateOptionalString(rilCompanyName, 'rilCompanyName');
      if (!rilCompanyNameResult.ok) return badRequest(reply, rilCompanyNameResult.message);

      const rilDefaultStartTimeResult = validateOptionalTimeOfDay(
        rilDefaultStartTime,
        'rilDefaultStartTime',
      );
      if (!rilDefaultStartTimeResult.ok) {
        return badRequest(reply, rilDefaultStartTimeResult.message);
      }

      const rilLunchBreakMinutesResult = validateOptionalLunchBreakMinutes(rilLunchBreakMinutes);
      if (!rilLunchBreakMinutesResult.ok) {
        return badRequest(reply, rilLunchBreakMinutesResult.message);
      }

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

      const treatSaturdayAsHolidayResult = parseBooleanField(body, 'treatSaturdayAsHoliday');
      if (!treatSaturdayAsHolidayResult.ok) {
        return badRequest(reply, treatSaturdayAsHolidayResult.message);
      }
      const enableAiReportingResult = parseBooleanField(body, 'enableAiReporting');
      if (!enableAiReportingResult.ok) return badRequest(reply, enableAiReportingResult.message);
      const allowWeekendSelectionResult = parseBooleanField(body, 'allowWeekendSelection');
      if (!allowWeekendSelectionResult.ok) {
        return badRequest(reply, allowWeekendSelectionResult.message);
      }

      const settings = await generalSettingsRepo.update({
        currency: currencyResult.value,
        dailyLimit: dailyLimitResult.value,
        startOfWeek: startOfWeekResult.value,
        treatSaturdayAsHoliday: treatSaturdayAsHolidayResult.value,
        enableAiReporting: enableAiReportingResult.value,
        geminiApiKey,
        aiProvider: aiProviderResult.value,
        openrouterApiKey,
        geminiModelId,
        openrouterModelId,
        allowWeekendSelection: allowWeekendSelectionResult.value,
        defaultLocation: defaultLocationResult.value,
        rilCompanyName: rilCompanyNameResult.value,
        rilDefaultStartTime: rilDefaultStartTimeResult.value,
        rilLunchBreakMinutes: rilLunchBreakMinutesResult.value,
      });

      await logAudit({
        request,
        action: 'settings.updated',
        entityType: 'settings',
        details: {
          secondaryLabel: settings.aiProvider ?? undefined,
        },
      });
      return toResponse(settings, true);
    },
  );
}
