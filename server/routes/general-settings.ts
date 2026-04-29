import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as generalSettingsRepo from '../repositories/generalSettingsRepo.ts';
import { standardRateLimitedErrorResponses } from '../schemas/common.ts';
import { logAudit } from '../utils/audit.ts';
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
};

const maskApiKey = (value: string | null, reveal: boolean) =>
  reveal ? (value ?? '') : value ? '********' : '';

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
});

export default async function (fastify: FastifyInstance, _opts: unknown) {
  fastify.get(
    '/',
    {
      onRequest: [authenticateToken],
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
      onRequest: [authenticateToken, requirePermission('administration.general.update')],
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
      if (!currencyResult.ok) return badRequest(reply, currencyResult.message);

      const dailyLimitResult = optionalLocalizedNonNegativeNumber(dailyLimit, 'dailyLimit');
      if (!dailyLimitResult.ok) return badRequest(reply, dailyLimitResult.message);

      const aiProviderResult = optionalEnum(aiProvider, ['gemini', 'openrouter'], 'aiProvider');
      if (!aiProviderResult.ok) return badRequest(reply, aiProviderResult.message);

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

      const settings = await generalSettingsRepo.update({
        currency: currencyResult.value,
        dailyLimit: dailyLimitResult.value,
        startOfWeek,
        treatSaturdayAsHoliday: treatSaturdayAsHolidayValue,
        enableAiReporting: enableAiReportingValue,
        geminiApiKey,
        aiProvider: aiProviderResult.value,
        openrouterApiKey,
        geminiModelId,
        openrouterModelId,
        allowWeekendSelection: allowWeekendSelectionValue,
        defaultLocation,
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
