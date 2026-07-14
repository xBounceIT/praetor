import { eq, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import type { AiProvider, StoredRilNoteOption } from '../db/schema/generalSettings.ts';
import { generalSettings } from '../db/schema/generalSettings.ts';
import { normalizeSessionIdleTimeoutMinutes } from '../utils/sessionTimeout.ts';

export type GeneralSettings = {
  currency: string;
  dailyLimit: number;
  startOfWeek: string;
  treatSaturdayAsHoliday: boolean;
  enableAiReporting: boolean | null;
  enableTotp: boolean | null;
  enforceTotp: boolean | null;
  totpEnforcedRoleIds: string[] | null;
  totpExemptRoleIds: string[] | null;
  totpExemptUserIds: string[] | null;
  sessionIdleTimeoutMinutes: number;
  geminiApiKey: string | null;
  aiProvider: AiProvider | null;
  openrouterApiKey: string | null;
  geminiModelId: string | null;
  openrouterModelId: string | null;
  ollamaBaseUrl: string;
  ollamaBearerToken: string | null;
  ollamaModelId: string | null;
  allowWeekendSelection: boolean | null;
  defaultLocation: string | null;
  rilCompanyName: string | null;
  rilDefaultStartTime: string | null;
  rilDefaultExitTime: string | null;
  rilLunchBreakMinutes: number | null;
  rilNoteOptions: StoredRilNoteOption[] | null;
  rilTransferOptions: string[] | null;
};

export type GeneralSettingsPatch = {
  currency?: string | null;
  dailyLimit?: number | null;
  startOfWeek?: string | null;
  treatSaturdayAsHoliday?: boolean | null;
  enableAiReporting?: boolean | null;
  enableTotp?: boolean | null;
  enforceTotp?: boolean | null;
  totpEnforcedRoleIds?: string[] | null;
  totpExemptRoleIds?: string[] | null;
  totpExemptUserIds?: string[] | null;
  sessionIdleTimeoutMinutes?: number | null;
  geminiApiKey?: string | null;
  aiProvider?: AiProvider | null;
  openrouterApiKey?: string | null;
  geminiModelId?: string | null;
  openrouterModelId?: string | null;
  ollamaBaseUrl?: string | null;
  ollamaBearerToken?: string | null;
  ollamaModelId?: string | null;
  allowWeekendSelection?: boolean | null;
  defaultLocation?: string | null;
  rilCompanyName?: string | null;
  rilDefaultStartTime?: string | null;
  rilDefaultExitTime?: string | null;
  rilLunchBreakMinutes?: number | null;
  rilNoteOptions?: StoredRilNoteOption[] | null;
  rilTransferOptions?: string[] | null;
};

const GENERAL_SETTINGS_PROJECTION = {
  currency: generalSettings.currency,
  dailyLimit: generalSettings.dailyLimit,
  startOfWeek: generalSettings.startOfWeek,
  treatSaturdayAsHoliday: generalSettings.treatSaturdayAsHoliday,
  enableAiReporting: generalSettings.enableAiReporting,
  enableTotp: generalSettings.enableTotp,
  enforceTotp: generalSettings.enforceTotp,
  totpEnforcedRoleIds: generalSettings.totpEnforcedRoleIds,
  totpExemptRoleIds: generalSettings.totpExemptRoleIds,
  totpExemptUserIds: generalSettings.totpExemptUserIds,
  sessionIdleTimeoutMinutes: generalSettings.sessionIdleTimeoutMinutes,
  geminiApiKey: generalSettings.geminiApiKey,
  aiProvider: generalSettings.aiProvider,
  openrouterApiKey: generalSettings.openrouterApiKey,
  geminiModelId: generalSettings.geminiModelId,
  openrouterModelId: generalSettings.openrouterModelId,
  ollamaBaseUrl: generalSettings.ollamaBaseUrl,
  ollamaBearerToken: generalSettings.ollamaBearerToken,
  ollamaModelId: generalSettings.ollamaModelId,
  allowWeekendSelection: generalSettings.allowWeekendSelection,
  defaultLocation: generalSettings.defaultLocation,
  rilCompanyName: generalSettings.rilCompanyName,
  rilDefaultStartTime: generalSettings.rilDefaultStartTime,
  rilDefaultExitTime: generalSettings.rilDefaultExitTime,
  rilLunchBreakMinutes: generalSettings.rilLunchBreakMinutes,
  rilNoteOptions: generalSettings.rilNoteOptions,
  rilTransferOptions: generalSettings.rilTransferOptions,
} as const;

type GeneralSettingsRow = {
  currency: string | null;
  dailyLimit: string | null;
  startOfWeek: string | null;
  treatSaturdayAsHoliday: boolean | null;
  enableAiReporting: boolean | null;
  enableTotp: boolean | null;
  enforceTotp: boolean | null;
  totpEnforcedRoleIds: string[] | null;
  totpExemptRoleIds: string[] | null;
  totpExemptUserIds: string[] | null;
  sessionIdleTimeoutMinutes: number | null;
  geminiApiKey: string | null;
  aiProvider: AiProvider | null;
  openrouterApiKey: string | null;
  geminiModelId: string | null;
  openrouterModelId: string | null;
  ollamaBaseUrl: string | null;
  ollamaBearerToken: string | null;
  ollamaModelId: string | null;
  allowWeekendSelection: boolean | null;
  defaultLocation: string | null;
  rilCompanyName: string | null;
  rilDefaultStartTime: string | null;
  rilDefaultExitTime: string | null;
  rilLunchBreakMinutes: number | null;
  rilNoteOptions: StoredRilNoteOption[] | null;
  rilTransferOptions: string[] | null;
};

// Centralized fallbacks for the non-nullable `GeneralSettings` fields. The schema
// columns are nullable in TS (Drizzle infers from `.default(...)` without `.notNull()`)
// but always populated at runtime via DB defaults on the seeded id=1 row, so these
// fallbacks are TS-strict appeasement that fire only on a never-actually-happens null.
// Values MUST mirror the `.default(...)` calls in `db/schema/generalSettings.ts` (and the
// underlying DEFAULTs in `schema.sql:693-720`); the `mapRow defaults match the schema
// column defaults` test in the repo's spec guards against drift across the three places.
// `dailyLimit` is the string form because pg returns `numeric` as a string and `parseFloat`
// runs on it inside `mapRow`.
//
// Other columns with DB defaults (e.g., `enableAiReporting`, `allowWeekendSelection`) are
// typed `T | null` in the public `GeneralSettings` type, so `mapRow` forwards null without
// a fallback - route consumers apply their own `?? default`.
const DEFAULT_FALLBACKS = {
  currency: '€',
  dailyLimit: '8.00',
  startOfWeek: 'Monday',
  treatSaturdayAsHoliday: true,
  sessionIdleTimeoutMinutes: 30,
  ollamaBaseUrl: 'http://localhost:11434',
} as const;

const mapRow = (row: GeneralSettingsRow): GeneralSettings => ({
  currency: row.currency ?? DEFAULT_FALLBACKS.currency,
  dailyLimit: parseFloat(row.dailyLimit ?? DEFAULT_FALLBACKS.dailyLimit),
  startOfWeek: row.startOfWeek ?? DEFAULT_FALLBACKS.startOfWeek,
  treatSaturdayAsHoliday: row.treatSaturdayAsHoliday ?? DEFAULT_FALLBACKS.treatSaturdayAsHoliday,
  enableAiReporting: row.enableAiReporting,
  enableTotp: row.enableTotp,
  enforceTotp: row.enforceTotp,
  totpEnforcedRoleIds: row.totpEnforcedRoleIds,
  totpExemptRoleIds: row.totpExemptRoleIds,
  totpExemptUserIds: row.totpExemptUserIds,
  sessionIdleTimeoutMinutes: normalizeSessionIdleTimeoutMinutes(
    row.sessionIdleTimeoutMinutes ?? DEFAULT_FALLBACKS.sessionIdleTimeoutMinutes,
  ),
  geminiApiKey: row.geminiApiKey,
  aiProvider: row.aiProvider,
  openrouterApiKey: row.openrouterApiKey,
  geminiModelId: row.geminiModelId,
  openrouterModelId: row.openrouterModelId,
  ollamaBaseUrl: row.ollamaBaseUrl ?? DEFAULT_FALLBACKS.ollamaBaseUrl,
  ollamaBearerToken: row.ollamaBearerToken,
  ollamaModelId: row.ollamaModelId,
  allowWeekendSelection: row.allowWeekendSelection,
  defaultLocation: row.defaultLocation,
  rilCompanyName: row.rilCompanyName,
  rilDefaultStartTime: row.rilDefaultStartTime,
  rilDefaultExitTime: row.rilDefaultExitTime,
  rilLunchBreakMinutes: row.rilLunchBreakMinutes,
  rilNoteOptions: row.rilNoteOptions,
  rilTransferOptions: row.rilTransferOptions,
});

export const get = async (exec: DbExecutor = db): Promise<GeneralSettings | null> => {
  const rows = await exec
    .select(GENERAL_SETTINGS_PROJECTION)
    .from(generalSettings)
    .where(eq(generalSettings.id, 1));
  return rows[0] ? mapRow(rows[0]) : null;
};

export const update = async (
  patch: GeneralSettingsPatch,
  exec: DbExecutor = db,
): Promise<GeneralSettings> => {
  // COALESCE preserves the existing column when the patch value is nullish (legacy
  // "undefined/null leaves column unchanged" semantic). Same pattern as ldapRepo.update /
  // emailRepo.update / settingsRepo.upsertForUser.
  const rilNoteOptionsParam =
    patch.rilNoteOptions == null ? null : JSON.stringify(patch.rilNoteOptions);
  const rilTransferOptionsParam =
    patch.rilTransferOptions == null ? null : JSON.stringify(patch.rilTransferOptions);
  const totpEnforcedRoleIdsParam =
    patch.totpEnforcedRoleIds == null ? null : JSON.stringify(patch.totpEnforcedRoleIds);
  const totpExemptRoleIdsParam =
    patch.totpExemptRoleIds == null ? null : JSON.stringify(patch.totpExemptRoleIds);
  const totpExemptUserIdsParam =
    patch.totpExemptUserIds == null ? null : JSON.stringify(patch.totpExemptUserIds);

  const result = await exec
    .update(generalSettings)
    .set({
      currency: sql`COALESCE(${patch.currency ?? null}, ${generalSettings.currency})`,
      dailyLimit: sql`COALESCE(${patch.dailyLimit ?? null}, ${generalSettings.dailyLimit})`,
      startOfWeek: sql`COALESCE(${patch.startOfWeek ?? null}, ${generalSettings.startOfWeek})`,
      treatSaturdayAsHoliday: sql`COALESCE(${patch.treatSaturdayAsHoliday ?? null}, ${generalSettings.treatSaturdayAsHoliday})`,
      enableAiReporting: sql`COALESCE(${patch.enableAiReporting ?? null}, ${generalSettings.enableAiReporting})`,
      enableTotp: sql`COALESCE(${patch.enableTotp ?? null}, ${generalSettings.enableTotp})`,
      enforceTotp: sql`COALESCE(${patch.enforceTotp ?? null}, ${generalSettings.enforceTotp})`,
      totpEnforcedRoleIds: sql`COALESCE(${totpEnforcedRoleIdsParam}::jsonb, ${generalSettings.totpEnforcedRoleIds})`,
      totpExemptRoleIds: sql`COALESCE(${totpExemptRoleIdsParam}::jsonb, ${generalSettings.totpExemptRoleIds})`,
      totpExemptUserIds: sql`COALESCE(${totpExemptUserIdsParam}::jsonb, ${generalSettings.totpExemptUserIds})`,
      sessionIdleTimeoutMinutes: sql`COALESCE(${patch.sessionIdleTimeoutMinutes ?? null}, ${generalSettings.sessionIdleTimeoutMinutes})`,
      geminiApiKey: sql`COALESCE(${patch.geminiApiKey ?? null}, ${generalSettings.geminiApiKey})`,
      aiProvider: sql`COALESCE(${patch.aiProvider ?? null}, ${generalSettings.aiProvider})`,
      openrouterApiKey: sql`COALESCE(${patch.openrouterApiKey ?? null}, ${generalSettings.openrouterApiKey})`,
      geminiModelId: sql`COALESCE(${patch.geminiModelId ?? null}, ${generalSettings.geminiModelId})`,
      openrouterModelId: sql`COALESCE(${patch.openrouterModelId ?? null}, ${generalSettings.openrouterModelId})`,
      ollamaBaseUrl: sql`COALESCE(${patch.ollamaBaseUrl ?? null}, ${generalSettings.ollamaBaseUrl})`,
      ollamaBearerToken: sql`COALESCE(${patch.ollamaBearerToken ?? null}, ${generalSettings.ollamaBearerToken})`,
      ollamaModelId: sql`COALESCE(${patch.ollamaModelId ?? null}, ${generalSettings.ollamaModelId})`,
      allowWeekendSelection: sql`COALESCE(${patch.allowWeekendSelection ?? null}, ${generalSettings.allowWeekendSelection})`,
      defaultLocation: sql`COALESCE(${patch.defaultLocation ?? null}, ${generalSettings.defaultLocation})`,
      rilCompanyName: sql`COALESCE(${patch.rilCompanyName ?? null}, ${generalSettings.rilCompanyName})`,
      rilDefaultStartTime: sql`COALESCE(${patch.rilDefaultStartTime ?? null}, ${generalSettings.rilDefaultStartTime})`,
      rilDefaultExitTime: sql`COALESCE(${patch.rilDefaultExitTime ?? null}, ${generalSettings.rilDefaultExitTime})`,
      rilLunchBreakMinutes: sql`COALESCE(${patch.rilLunchBreakMinutes ?? null}, ${generalSettings.rilLunchBreakMinutes})`,
      rilNoteOptions: sql`COALESCE(${rilNoteOptionsParam}::jsonb, ${generalSettings.rilNoteOptions})`,
      rilTransferOptions: sql`COALESCE(${rilTransferOptionsParam}::jsonb, ${generalSettings.rilTransferOptions})`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(generalSettings.id, 1))
    .returning(GENERAL_SETTINGS_PROJECTION);
  if (result.length === 0) {
    throw new Error('general_settings row (id=1) not found; seed missing');
  }
  return mapRow(result[0]);
};
