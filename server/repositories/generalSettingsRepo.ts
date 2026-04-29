import pool, { type QueryExecutor } from '../db/index.ts';

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

type GeneralSettingsRow = Omit<GeneralSettings, 'dailyLimit'> & { dailyLimit: string };

const SELECT_COLUMNS = `currency,
        daily_limit as "dailyLimit",
        start_of_week as "startOfWeek",
        treat_saturday_as_holiday as "treatSaturdayAsHoliday",
        enable_ai_reporting as "enableAiReporting",
        gemini_api_key as "geminiApiKey",
        ai_provider as "aiProvider",
        openrouter_api_key as "openrouterApiKey",
        gemini_model_id as "geminiModelId",
        openrouter_model_id as "openrouterModelId",
        allow_weekend_selection as "allowWeekendSelection",
        default_location as "defaultLocation"`;

const mapRow = (row: GeneralSettingsRow): GeneralSettings => ({
  ...row,
  dailyLimit: parseFloat(row.dailyLimit),
});

export const get = async (exec: QueryExecutor = pool): Promise<GeneralSettings | null> => {
  const { rows } = await exec.query<GeneralSettingsRow>(
    `SELECT ${SELECT_COLUMNS} FROM general_settings WHERE id = 1`,
  );
  if (rows.length === 0) return null;
  return mapRow(rows[0]);
};

export const update = async (
  patch: GeneralSettingsPatch,
  exec: QueryExecutor = pool,
): Promise<GeneralSettings> => {
  const { rows } = await exec.query<GeneralSettingsRow>(
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
      RETURNING ${SELECT_COLUMNS}`,
    [
      patch.currency,
      patch.dailyLimit,
      patch.startOfWeek,
      patch.treatSaturdayAsHoliday,
      patch.enableAiReporting,
      patch.geminiApiKey,
      patch.aiProvider,
      patch.openrouterApiKey,
      patch.geminiModelId,
      patch.openrouterModelId,
      patch.allowWeekendSelection,
      patch.defaultLocation,
    ],
  );
  return mapRow(rows[0]);
};
