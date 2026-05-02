import { eq, sql } from 'drizzle-orm';
import { type DbExecutor, db } from '../db/drizzle.ts';
import { generalSettings } from '../db/schema/generalSettings.ts';

export type GeneralSettings = {
  currency: string;
  dailyLimit: number;
  startOfWeek: string;
  treatSaturdayAsHoliday: boolean;
  enableAiReporting: boolean | null;
  geminiApiKey: string | null;
  aiProvider: string | null;
  openrouterApiKey: string | null;
  geminiModelId: string | null;
  openrouterModelId: string | null;
  allowWeekendSelection: boolean | null;
  defaultLocation: string | null;
};

export type GeneralSettingsPatch = {
  currency?: string | null;
  dailyLimit?: number | null;
  startOfWeek?: string | null;
  treatSaturdayAsHoliday?: boolean | null;
  enableAiReporting?: boolean | null;
  geminiApiKey?: string | null;
  aiProvider?: string | null;
  openrouterApiKey?: string | null;
  geminiModelId?: string | null;
  openrouterModelId?: string | null;
  allowWeekendSelection?: boolean | null;
  defaultLocation?: string | null;
};

const GENERAL_SETTINGS_PROJECTION = {
  currency: generalSettings.currency,
  dailyLimit: generalSettings.dailyLimit,
  startOfWeek: generalSettings.startOfWeek,
  treatSaturdayAsHoliday: generalSettings.treatSaturdayAsHoliday,
  enableAiReporting: generalSettings.enableAiReporting,
  geminiApiKey: generalSettings.geminiApiKey,
  aiProvider: generalSettings.aiProvider,
  openrouterApiKey: generalSettings.openrouterApiKey,
  geminiModelId: generalSettings.geminiModelId,
  openrouterModelId: generalSettings.openrouterModelId,
  allowWeekendSelection: generalSettings.allowWeekendSelection,
  defaultLocation: generalSettings.defaultLocation,
} as const;

type GeneralSettingsRow = {
  currency: string | null;
  dailyLimit: string | null;
  startOfWeek: string | null;
  treatSaturdayAsHoliday: boolean | null;
  enableAiReporting: boolean | null;
  geminiApiKey: string | null;
  aiProvider: string | null;
  openrouterApiKey: string | null;
  geminiModelId: string | null;
  openrouterModelId: string | null;
  allowWeekendSelection: boolean | null;
  defaultLocation: string | null;
};

// Schema columns are nullable but always populated at runtime via DB defaults on the seeded
// id=1 row, so the `??` fallbacks on the four non-nullable fields are TS-strict appeasement
// matching the corresponding `schema.sql` DEFAULTs. Nullable fields pass through as-is.
// `daily_limit` is a `numeric` column — pg returns it as a string; `parseFloat` converts it
// to JS number to match `GeneralSettings.dailyLimit: number`.
const mapRow = (row: GeneralSettingsRow): GeneralSettings => ({
  currency: row.currency ?? '€',
  dailyLimit: parseFloat(row.dailyLimit ?? '8.00'),
  startOfWeek: row.startOfWeek ?? 'Monday',
  treatSaturdayAsHoliday: row.treatSaturdayAsHoliday ?? true,
  enableAiReporting: row.enableAiReporting,
  geminiApiKey: row.geminiApiKey,
  aiProvider: row.aiProvider,
  openrouterApiKey: row.openrouterApiKey,
  geminiModelId: row.geminiModelId,
  openrouterModelId: row.openrouterModelId,
  allowWeekendSelection: row.allowWeekendSelection,
  defaultLocation: row.defaultLocation,
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
  // COALESCE preserves the existing column when the patch value is undefined (legacy
  // "undefined leaves column unchanged" semantic). Same pattern as ldapRepo.update /
  // emailRepo.update / settingsRepo.upsertForUser.
  const result = await exec
    .update(generalSettings)
    .set({
      currency: sql`COALESCE(${patch.currency ?? null}, ${generalSettings.currency})`,
      dailyLimit: sql`COALESCE(${patch.dailyLimit ?? null}, ${generalSettings.dailyLimit})`,
      startOfWeek: sql`COALESCE(${patch.startOfWeek ?? null}, ${generalSettings.startOfWeek})`,
      treatSaturdayAsHoliday: sql`COALESCE(${patch.treatSaturdayAsHoliday ?? null}, ${generalSettings.treatSaturdayAsHoliday})`,
      enableAiReporting: sql`COALESCE(${patch.enableAiReporting ?? null}, ${generalSettings.enableAiReporting})`,
      geminiApiKey: sql`COALESCE(${patch.geminiApiKey ?? null}, ${generalSettings.geminiApiKey})`,
      aiProvider: sql`COALESCE(${patch.aiProvider ?? null}, ${generalSettings.aiProvider})`,
      openrouterApiKey: sql`COALESCE(${patch.openrouterApiKey ?? null}, ${generalSettings.openrouterApiKey})`,
      geminiModelId: sql`COALESCE(${patch.geminiModelId ?? null}, ${generalSettings.geminiModelId})`,
      openrouterModelId: sql`COALESCE(${patch.openrouterModelId ?? null}, ${generalSettings.openrouterModelId})`,
      allowWeekendSelection: sql`COALESCE(${patch.allowWeekendSelection ?? null}, ${generalSettings.allowWeekendSelection})`,
      defaultLocation: sql`COALESCE(${patch.defaultLocation ?? null}, ${generalSettings.defaultLocation})`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(generalSettings.id, 1))
    .returning(GENERAL_SETTINGS_PROJECTION);
  if (result.length === 0) {
    throw new Error('general_settings row (id=1) not found; seed missing');
  }
  return mapRow(result[0]);
};
