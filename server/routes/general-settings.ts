import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withDbTransaction } from '../db/drizzle.ts';
import { authenticateToken, requirePermission } from '../middleware/auth.ts';
import * as generalSettingsRepo from '../repositories/generalSettingsRepo.ts';
import * as usersRepo from '../repositories/usersRepo.ts';
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

const DEFAULT_RIL_NOTE_OPTIONS = [
  { value: 'P', label: 'Ferie' },
  { value: 'P2', label: 'Permesso' },
  { value: 'M', label: 'Malattia' },
  { value: 'F', label: 'Festivita' },
] as const;
const DEFAULT_RIL_TRANSFER_OPTIONS = ['In sede', 'Telelavoro'] as const;

type RilNoteOption = {
  value: string;
  label: string;
};

const rilNoteOptionsSchema = {
  type: 'array',
  minItems: 1,
  maxItems: 30,
  items: {
    type: 'object',
    properties: {
      value: { type: 'string' },
      label: { type: 'string' },
    },
    required: ['value', 'label'],
    additionalProperties: false,
  },
} as const;

const rilTransferOptionsSchema = {
  type: 'array',
  minItems: 1,
  maxItems: 30,
  items: { type: 'string' },
} as const;

// Role-id lists for the 2FA enforce/exempt policy. Free-form strings (role ids), like the RIL
// arrays — no foreign-key check, matching the existing array-field convention.
const roleIdArraySchema = {
  type: 'array',
  maxItems: 100,
  items: { type: 'string' },
} as const;

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
    rilDefaultExitTime: { type: 'string' },
    rilLunchBreakMinutes: { type: 'integer' },
    rilNoteOptions: rilNoteOptionsSchema,
    rilTransferOptions: rilTransferOptionsSchema,
    enableTotp: { type: 'boolean' },
    enforceTotp: { type: 'boolean' },
    totpEnforcedRoleIds: roleIdArraySchema,
    totpExemptRoleIds: roleIdArraySchema,
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
    'rilDefaultExitTime',
    'rilLunchBreakMinutes',
    'rilNoteOptions',
    'rilTransferOptions',
    'enableTotp',
    'enforceTotp',
    'totpEnforcedRoleIds',
    'totpExemptRoleIds',
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
    rilDefaultExitTime: { type: 'string' },
    rilLunchBreakMinutes: { type: 'integer' },
    rilNoteOptions: rilNoteOptionsSchema,
    rilTransferOptions: rilTransferOptionsSchema,
    enableTotp: { type: 'boolean' },
    enforceTotp: { type: 'boolean' },
    totpEnforcedRoleIds: roleIdArraySchema,
    totpExemptRoleIds: roleIdArraySchema,
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
  rilDefaultExitTime: '18:00',
  rilLunchBreakMinutes: 60,
  rilNoteOptions: DEFAULT_RIL_NOTE_OPTIONS.map((option) => ({ ...option })),
  rilTransferOptions: [...DEFAULT_RIL_TRANSFER_OPTIONS],
  enableTotp: true,
  enforceTotp: false,
  totpEnforcedRoleIds: [],
  totpExemptRoleIds: [],
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

const validateOptionString = (
  value: unknown,
  fieldName: string,
  maxLength: number,
): { ok: true; value: string } | { ok: false; message: string } => {
  if (typeof value !== 'string') {
    return { ok: false, message: `${fieldName} must be a string` };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, message: `${fieldName} cannot be blank` };
  }
  if (trimmed.length > maxLength) {
    return { ok: false, message: `${fieldName} must be ${maxLength} characters or fewer` };
  }
  return { ok: true, value: trimmed };
};

const normalizeRilNoteOptions = (value: unknown): RilNoteOption[] => {
  if (!Array.isArray(value)) return DEFAULT_RIL_NOTE_OPTIONS.map((option) => ({ ...option }));
  const options: RilNoteOption[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const option = entry as Partial<RilNoteOption>;
    const code = typeof option.value === 'string' ? option.value.trim() : '';
    if (!code || seen.has(code)) continue;
    const label = typeof option.label === 'string' ? option.label.trim() : '';
    options.push({ value: code, label: label || code });
    seen.add(code);
  }
  return options.length > 0 ? options : DEFAULT_RIL_NOTE_OPTIONS.map((option) => ({ ...option }));
};

const normalizeRilTransferOptions = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [...DEFAULT_RIL_TRANSFER_OPTIONS];
  const options: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const option = typeof entry === 'string' ? entry.trim() : '';
    if (!option || seen.has(option)) continue;
    options.push(option);
    seen.add(option);
  }
  return options.length > 0 ? options : [...DEFAULT_RIL_TRANSFER_OPTIONS];
};

const validateOptionalRilNoteOptions = (value: unknown) => {
  if (value === undefined || value === null) {
    return { ok: true as const, value: null };
  }
  if (!Array.isArray(value)) {
    return { ok: false as const, message: 'rilNoteOptions must be an array' };
  }
  if (value.length === 0 || value.length > 30) {
    return { ok: false as const, message: 'rilNoteOptions must contain 1 to 30 options' };
  }

  const options: RilNoteOption[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return {
        ok: false as const,
        message: `rilNoteOptions[${index}] must be an object`,
      };
    }
    const option = entry as Partial<RilNoteOption>;
    const valueResult = validateOptionString(option.value, `rilNoteOptions[${index}].value`, 20);
    if (!valueResult.ok) return valueResult;
    const labelResult = validateOptionString(option.label, `rilNoteOptions[${index}].label`, 120);
    if (!labelResult.ok) return labelResult;
    if (seen.has(valueResult.value)) continue;
    options.push({ value: valueResult.value, label: labelResult.value });
    seen.add(valueResult.value);
  }

  if (options.length === 0) {
    return { ok: false as const, message: 'rilNoteOptions must contain at least one valid option' };
  }
  return { ok: true as const, value: options };
};

const validateOptionalRilTransferOptions = (value: unknown) => {
  if (value === undefined || value === null) {
    return { ok: true as const, value: null };
  }
  if (!Array.isArray(value)) {
    return { ok: false as const, message: 'rilTransferOptions must be an array' };
  }
  if (value.length === 0 || value.length > 30) {
    return { ok: false as const, message: 'rilTransferOptions must contain 1 to 30 options' };
  }

  const options: string[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const result = validateOptionString(entry, `rilTransferOptions[${index}]`, 120);
    if (!result.ok) return result;
    if (seen.has(result.value)) continue;
    options.push(result.value);
    seen.add(result.value);
  }

  if (options.length === 0) {
    return {
      ok: false as const,
      message: 'rilTransferOptions must contain at least one valid option',
    };
  }
  return { ok: true as const, value: options };
};

// Validate a 2FA enforce/exempt role-id list: an optional array of non-empty role-id strings
// (deduplicated). null/undefined leaves the column unchanged (COALESCE). An empty array is a valid,
// meaningful value (clears the list) so it is preserved rather than coerced to null. Role ids are
// free-form strings (no FK check), matching the rilTransferOptions convention.
const validateOptionalRoleIdArray = (value: unknown, fieldName: string) => {
  if (value === undefined || value === null) {
    return { ok: true as const, value: null };
  }
  if (!Array.isArray(value)) {
    return { ok: false as const, message: `${fieldName} must be an array` };
  }
  if (value.length > 100) {
    return { ok: false as const, message: `${fieldName} must contain 100 or fewer roles` };
  }
  const roleIds: string[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const result = validateOptionString(entry, `${fieldName}[${index}]`, 50);
    if (!result.ok) return result;
    if (seen.has(result.value)) continue;
    roleIds.push(result.value);
    seen.add(result.value);
  }
  return { ok: true as const, value: roleIds };
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
  rilDefaultExitTime: settings.rilDefaultExitTime || '18:00',
  rilLunchBreakMinutes: settings.rilLunchBreakMinutes ?? 60,
  rilNoteOptions: normalizeRilNoteOptions(settings.rilNoteOptions),
  rilTransferOptions: normalizeRilTransferOptions(settings.rilTransferOptions),
  enableTotp: settings.enableTotp ?? true,
  enforceTotp: settings.enforceTotp ?? false,
  totpEnforcedRoleIds: settings.totpEnforcedRoleIds ?? [],
  totpExemptRoleIds: settings.totpExemptRoleIds ?? [],
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
        rilDefaultExitTime?: string;
        rilLunchBreakMinutes?: number;
        rilNoteOptions?: RilNoteOption[];
        rilTransferOptions?: string[];
        enableTotp?: boolean;
        enforceTotp?: boolean;
        totpEnforcedRoleIds?: string[];
        totpExemptRoleIds?: string[];
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
        rilDefaultExitTime,
        rilLunchBreakMinutes,
        rilNoteOptions,
        rilTransferOptions,
        totpEnforcedRoleIds,
        totpExemptRoleIds,
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

      const rilDefaultExitTimeResult = validateOptionalTimeOfDay(
        rilDefaultExitTime,
        'rilDefaultExitTime',
      );
      if (!rilDefaultExitTimeResult.ok) {
        return badRequest(reply, rilDefaultExitTimeResult.message);
      }

      const rilLunchBreakMinutesResult = validateOptionalLunchBreakMinutes(rilLunchBreakMinutes);
      if (!rilLunchBreakMinutesResult.ok) {
        return badRequest(reply, rilLunchBreakMinutesResult.message);
      }

      const rilNoteOptionsResult = validateOptionalRilNoteOptions(rilNoteOptions);
      if (!rilNoteOptionsResult.ok) return badRequest(reply, rilNoteOptionsResult.message);

      const rilTransferOptionsResult = validateOptionalRilTransferOptions(rilTransferOptions);
      if (!rilTransferOptionsResult.ok) {
        return badRequest(reply, rilTransferOptionsResult.message);
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
      const enableTotpResult = parseBooleanField(body, 'enableTotp');
      if (!enableTotpResult.ok) return badRequest(reply, enableTotpResult.message);
      const enforceTotpResult = parseBooleanField(body, 'enforceTotp');
      if (!enforceTotpResult.ok) return badRequest(reply, enforceTotpResult.message);
      const totpEnforcedRoleIdsResult = validateOptionalRoleIdArray(
        totpEnforcedRoleIds,
        'totpEnforcedRoleIds',
      );
      if (!totpEnforcedRoleIdsResult.ok)
        return badRequest(reply, totpEnforcedRoleIdsResult.message);
      const totpExemptRoleIdsResult = validateOptionalRoleIdArray(
        totpExemptRoleIds,
        'totpExemptRoleIds',
      );
      if (!totpExemptRoleIdsResult.ok) return badRequest(reply, totpExemptRoleIdsResult.message);

      const previousSettings = await generalSettingsRepo.get();
      const settingsPatch = {
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
        rilDefaultExitTime: rilDefaultExitTimeResult.value,
        rilLunchBreakMinutes: rilLunchBreakMinutesResult.value,
        rilNoteOptions: rilNoteOptionsResult.value,
        rilTransferOptions: rilTransferOptionsResult.value,
        enableTotp: enableTotpResult.value,
        enforceTotp: enforceTotpResult.value,
        totpEnforcedRoleIds: totpEnforcedRoleIdsResult.value,
        totpExemptRoleIds: totpExemptRoleIdsResult.value,
      };

      // Resolve the policy that WILL be in effect after this write (a null patch value leaves the
      // existing column unchanged via COALESCE, so fall back to the previous value, then the default).
      const resultEnableTotp = enableTotpResult.value ?? previousSettings?.enableTotp ?? true;
      const resultEnforceTotp = enforceTotpResult.value ?? previousSettings?.enforceTotp ?? false;
      const resultEnforcedRoleIds =
        totpEnforcedRoleIdsResult.value ?? previousSettings?.totpEnforcedRoleIds ?? [];
      const resultExemptRoleIds =
        totpExemptRoleIdsResult.value ?? previousSettings?.totpExemptRoleIds ?? [];

      // Whenever the resulting policy enforces anyone AND an enforcement-relevant field actually
      // changed (turning the feature/enforcement on, or broadening the enforced/exempt role sets),
      // revoke the non-interactive credentials (PAT/MCP tokens) of every now-enforced user who hasn't
      // enrolled — those tokens never traverse the login 2FA gate, so a token predating the change
      // would otherwise keep privileged API access with no second factor until it expires. Interactive
      // sessions are deliberately NOT revoked: an unenrolled enforced user is routed into enrollment on
      // their next sign-in (auth.ts) and blocked from switching into an enforced role meanwhile, so the
      // policy takes hold without abruptly logging anyone out — most importantly the admin toggling it.
      // The setting write + token revocation run in ONE transaction so a crash can't persist the policy
      // while leaving stale tokens valid.
      const sameRoleSet = (a: string[], b: string[]): boolean =>
        a.length === b.length && [...a].sort().join(' ') === [...b].sort().join(' ');
      const enforcementRelevantChange =
        resultEnableTotp !== (previousSettings?.enableTotp ?? true) ||
        resultEnforceTotp !== (previousSettings?.enforceTotp ?? false) ||
        !sameRoleSet(resultEnforcedRoleIds, previousSettings?.totpEnforcedRoleIds ?? []) ||
        !sameRoleSet(resultExemptRoleIds, previousSettings?.totpExemptRoleIds ?? []);
      const shouldRevokeTokens = resultEnableTotp && resultEnforceTotp && enforcementRelevantChange;

      let settings: Awaited<ReturnType<typeof generalSettingsRepo.update>>;
      let revokedTokens = 0;
      if (shouldRevokeTokens) {
        const result = await withDbTransaction(async (tx) => {
          const updated = await generalSettingsRepo.update(settingsPatch, tx);
          const revoked = await usersRepo.revokeTokensForUnenrolledEnforcedUsers(
            resultEnforcedRoleIds,
            resultExemptRoleIds,
            tx,
          );
          return { updated, revoked };
        });
        settings = result.updated;
        revokedTokens = result.revoked;
      } else {
        settings = await generalSettingsRepo.update(settingsPatch);
      }

      await logAudit({
        request,
        action: 'settings.updated',
        entityType: 'settings',
        details: {
          secondaryLabel: settings.aiProvider ?? undefined,
        },
      });

      // Audit the revocation only after the transaction commits — an audit-write failure must not
      // roll back the security-critical token revocation it is recording.
      if (revokedTokens > 0) {
        await logAudit({
          request,
          action: 'settings.totp_enforcement_tokens_revoked',
          entityType: 'settings',
          details: { secondaryLabel: String(revokedTokens) },
        });
      }

      return toResponse(settings, true);
    },
  );
}
