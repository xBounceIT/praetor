import { eq, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import type { StoredRilNoteOption } from '../db/schema/generalSettings.ts';
import { generalSettings } from '../db/schema/generalSettings.ts';
import { decrypt, encrypt, isEncrypted } from '../utils/crypto.ts';
import { createChildLogger } from '../utils/logger.ts';
import { normalizeSessionIdleTimeoutMinutes } from '../utils/sessionTimeout.ts';

const logger = createChildLogger({ module: 'generalSettingsRepo' });

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
  aiProvider: string | null;
  openrouterApiKey: string | null;
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  localApiKey: string | null;
  localBaseUrl: string | null;
  geminiModelId: string | null;
  openrouterModelId: string | null;
  anthropicModelId: string | null;
  openaiModelId: string | null;
  localModelId: string | null;
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
  aiProvider?: string | null;
  openrouterApiKey?: string | null;
  anthropicApiKey?: string | null;
  openaiApiKey?: string | null;
  localApiKey?: string | null;
  localBaseUrl?: string | null;
  geminiModelId?: string | null;
  openrouterModelId?: string | null;
  anthropicModelId?: string | null;
  openaiModelId?: string | null;
  localModelId?: string | null;
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
  anthropicApiKey: generalSettings.anthropicApiKey,
  openaiApiKey: generalSettings.openaiApiKey,
  localApiKey: generalSettings.localApiKey,
  localBaseUrl: generalSettings.localBaseUrl,
  geminiModelId: generalSettings.geminiModelId,
  openrouterModelId: generalSettings.openrouterModelId,
  anthropicModelId: generalSettings.anthropicModelId,
  openaiModelId: generalSettings.openaiModelId,
  localModelId: generalSettings.localModelId,
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
  aiProvider: string | null;
  openrouterApiKey: string | null;
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  localApiKey: string | null;
  localBaseUrl: string | null;
  geminiModelId: string | null;
  openrouterModelId: string | null;
  anthropicModelId: string | null;
  openaiModelId: string | null;
  localModelId: string | null;
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
} as const;

export type AiProvider = 'gemini' | 'openrouter' | 'anthropic' | 'openai' | 'local';

const AI_API_KEY_FIELDS = {
  gemini: 'geminiApiKey',
  openrouter: 'openrouterApiKey',
  anthropic: 'anthropicApiKey',
  openai: 'openaiApiKey',
  local: 'localApiKey',
} as const satisfies Record<AiProvider, keyof GeneralSettingsRow>;

const isAiProvider = (value: string | null): value is AiProvider =>
  value !== null && Object.hasOwn(AI_API_KEY_FIELDS, value);

const decodeApiKey = (value: string | null): string | null => {
  if (!value || !isEncrypted(value)) return value;
  return decrypt(value);
};

const mapRow = (row: GeneralSettingsRow, decryptProvider?: AiProvider): GeneralSettings => ({
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
  geminiApiKey: decryptProvider === 'gemini' ? decodeApiKey(row.geminiApiKey) : row.geminiApiKey,
  aiProvider: row.aiProvider,
  openrouterApiKey:
    decryptProvider === 'openrouter' ? decodeApiKey(row.openrouterApiKey) : row.openrouterApiKey,
  anthropicApiKey:
    decryptProvider === 'anthropic' ? decodeApiKey(row.anthropicApiKey) : row.anthropicApiKey,
  openaiApiKey: decryptProvider === 'openai' ? decodeApiKey(row.openaiApiKey) : row.openaiApiKey,
  localApiKey: decryptProvider === 'local' ? decodeApiKey(row.localApiKey) : row.localApiKey,
  localBaseUrl: row.localBaseUrl,
  geminiModelId: row.geminiModelId,
  openrouterModelId: row.openrouterModelId,
  anthropicModelId: row.anthropicModelId,
  openaiModelId: row.openaiModelId,
  localModelId: row.localModelId,
  allowWeekendSelection: row.allowWeekendSelection,
  defaultLocation: row.defaultLocation,
  rilCompanyName: row.rilCompanyName,
  rilDefaultStartTime: row.rilDefaultStartTime,
  rilDefaultExitTime: row.rilDefaultExitTime,
  rilLunchBreakMinutes: row.rilLunchBreakMinutes,
  rilNoteOptions: row.rilNoteOptions,
  rilTransferOptions: row.rilTransferOptions,
});

const isLegacyPlaintext = (value: string | null): value is string =>
  Boolean(value) && !isEncrypted(value as string);

type AiApiKeyColumn =
  | typeof generalSettings.geminiApiKey
  | typeof generalSettings.openrouterApiKey
  | typeof generalSettings.anthropicApiKey
  | typeof generalSettings.openaiApiKey
  | typeof generalSettings.localApiKey;

// Encrypts pre-upgrade plaintext in place after a successful read. Each CASE is a compare-and-swap
// against the exact plaintext that was read, so a concurrent administrator update wins instead of
// being overwritten by the backfill. The operation is retry-safe: ciphertext is skipped next time.
const migrateLegacyApiKeysIfNeeded = async (
  row: GeneralSettingsRow,
  exec: DbExecutor,
): Promise<void> => {
  const plaintextValues = [
    row.geminiApiKey,
    row.openrouterApiKey,
    row.anthropicApiKey,
    row.openaiApiKey,
    row.localApiKey,
  ];
  if (!plaintextValues.some(isLegacyPlaintext)) return;

  const migrateValue = (value: string | null, column: AiApiKeyColumn) => {
    if (!isLegacyPlaintext(value)) return sql`${column}`;
    return sql`CASE WHEN ${column} = ${value} THEN ${encrypt(value)} ELSE ${column} END`;
  };

  try {
    await exec
      .update(generalSettings)
      .set({
        geminiApiKey: migrateValue(row.geminiApiKey, generalSettings.geminiApiKey),
        openrouterApiKey: migrateValue(row.openrouterApiKey, generalSettings.openrouterApiKey),
        anthropicApiKey: migrateValue(row.anthropicApiKey, generalSettings.anthropicApiKey),
        openaiApiKey: migrateValue(row.openaiApiKey, generalSettings.openaiApiKey),
        localApiKey: migrateValue(row.localApiKey, generalSettings.localApiKey),
      })
      .where(eq(generalSettings.id, 1));
  } catch {
    // Do not attach the Drizzle error: failed-query messages include bound parameters, and this
    // one-time compare-and-swap necessarily binds the legacy plaintext it is replacing.
    logger.warn('failed to migrate legacy plaintext AI provider keys to encrypted form');
  }
};

const read = async (
  exec: DbExecutor,
  decryptProvider?: AiProvider | 'configured',
): Promise<GeneralSettings | null> => {
  const rows = await exec
    .select(GENERAL_SETTINGS_PROJECTION)
    .from(generalSettings)
    .where(eq(generalSettings.id, 1));
  if (!rows[0]) return null;
  await migrateLegacyApiKeysIfNeeded(rows[0], exec);
  const provider =
    decryptProvider === 'configured'
      ? isAiProvider(rows[0].aiProvider)
        ? rows[0].aiProvider
        : 'gemini'
      : decryptProvider;
  return mapRow(rows[0], provider);
};

// Ordinary settings consumers (auth/session policy, time-entry policy, and the masked admin API)
// must not depend on decrypting unrelated AI credentials. Only AI execution paths opt in below.
export const get = (exec: DbExecutor = db): Promise<GeneralSettings | null> => read(exec);

export const getWithAiApiKey = (
  provider: AiProvider,
  exec: DbExecutor = db,
): Promise<GeneralSettings | null> => read(exec, provider);

export const getWithConfiguredAiApiKey = (exec: DbExecutor = db): Promise<GeneralSettings | null> =>
  read(exec, 'configured');

const encryptApiKeyPatch = (value: string | null | undefined): string | null =>
  value == null ? null : value === '' ? '' : encrypt(value);

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
      geminiApiKey: sql`COALESCE(${encryptApiKeyPatch(patch.geminiApiKey)}, ${generalSettings.geminiApiKey})`,
      aiProvider: sql`COALESCE(${patch.aiProvider ?? null}, ${generalSettings.aiProvider})`,
      openrouterApiKey: sql`COALESCE(${encryptApiKeyPatch(patch.openrouterApiKey)}, ${generalSettings.openrouterApiKey})`,
      anthropicApiKey: sql`COALESCE(${encryptApiKeyPatch(patch.anthropicApiKey)}, ${generalSettings.anthropicApiKey})`,
      openaiApiKey: sql`COALESCE(${encryptApiKeyPatch(patch.openaiApiKey)}, ${generalSettings.openaiApiKey})`,
      localApiKey: sql`COALESCE(${encryptApiKeyPatch(patch.localApiKey)}, ${generalSettings.localApiKey})`,
      localBaseUrl: sql`COALESCE(${patch.localBaseUrl ?? null}, ${generalSettings.localBaseUrl})`,
      geminiModelId: sql`COALESCE(${patch.geminiModelId ?? null}, ${generalSettings.geminiModelId})`,
      openrouterModelId: sql`COALESCE(${patch.openrouterModelId ?? null}, ${generalSettings.openrouterModelId})`,
      anthropicModelId: sql`COALESCE(${patch.anthropicModelId ?? null}, ${generalSettings.anthropicModelId})`,
      openaiModelId: sql`COALESCE(${patch.openaiModelId ?? null}, ${generalSettings.openaiModelId})`,
      localModelId: sql`COALESCE(${patch.localModelId ?? null}, ${generalSettings.localModelId})`,
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
