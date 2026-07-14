import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export type AiProvider = 'gemini' | 'openrouter' | 'anthropic' | 'openai' | 'ollama';

export type StoredRilNoteOption = {
  value: string;
  label: string;
};

// Single-row config table - `id` is pinned to 1 by both the column default and a CHECK.
// `daily_limit` is `numeric`: pg returns it as a string, the repo `parseFloat`s it in
// `mapRow`. Same pattern as `settings.dailyGoal`.
export const generalSettings = pgTable(
  'general_settings',
  {
    id: integer('id').primaryKey().default(1),
    currency: varchar('currency', { length: 10 }).default('€'),
    dailyLimit: numeric('daily_limit', { precision: 4, scale: 2 }).default('8.00'),
    startOfWeek: varchar('start_of_week', { length: 10 })
      .$type<'Monday' | 'Sunday'>()
      .default('Monday'),
    treatSaturdayAsHoliday: boolean('treat_saturday_as_holiday').default(true),
    enableAiReporting: boolean('enable_ai_reporting').default(false),
    // 2FA org policy. `enableTotp` is the global feature kill-switch (off = no enrollment, no login
    // challenge even for enrolled users, no enforcement). `enforceTotp` deliberately keeps the
    // original DB column name `enforce_totp_for_admins` — renaming the column would force a
    // destructive drop/recreate migration; only the TS/API name changed when admin-only enforcement
    // generalized to per-role enforcement. The jsonb arrays hold role ids and user ids: a user
    // is required to use 2FA when enforcement is active and (enforced list is empty OR they hold
    // an enforced role) AND they hold no exempt role and are not an exempt user (exempt wins).
    // Empty enforced list = everyone (local/ldap).
    enableTotp: boolean('enable_totp').notNull().default(true),
    enforceTotp: boolean('enforce_totp_for_admins').notNull().default(false),
    totpEnforcedRoleIds: jsonb('totp_enforced_role_ids')
      .$type<string[]>()
      .default(sql`'[]'::jsonb`),
    totpExemptRoleIds: jsonb('totp_exempt_role_ids').$type<string[]>().default(sql`'[]'::jsonb`),
    totpExemptUserIds: jsonb('totp_exempt_user_ids').$type<string[]>().default(sql`'[]'::jsonb`),
    sessionIdleTimeoutMinutes: integer('session_idle_timeout_minutes').notNull().default(30),
    geminiApiKey: varchar('gemini_api_key', { length: 255 }),
    aiProvider: varchar('ai_provider', { length: 20 }).$type<AiProvider>().default('gemini'),
    openrouterApiKey: varchar('openrouter_api_key', { length: 255 }),
    anthropicApiKey: varchar('anthropic_api_key', { length: 255 }),
    openaiApiKey: varchar('openai_api_key', { length: 255 }),
    geminiModelId: varchar('gemini_model_id', { length: 255 }),
    openrouterModelId: varchar('openrouter_model_id', { length: 255 }),
    anthropicModelId: varchar('anthropic_model_id', { length: 255 }),
    openaiModelId: varchar('openai_model_id', { length: 255 }),
    ollamaBaseUrl: varchar('ollama_base_url', { length: 2048 })
      .notNull()
      .default('http://localhost:11434'),
    ollamaBearerToken: varchar('ollama_bearer_token', { length: 2048 }),
    ollamaModelId: varchar('ollama_model_id', { length: 255 }),
    allowWeekendSelection: boolean('allow_weekend_selection').default(true),
    defaultLocation: varchar('default_location', { length: 20 }).default('remote'),
    rilCompanyName: varchar('ril_company_name', { length: 255 }).default(''),
    rilDefaultStartTime: varchar('ril_default_start_time', { length: 5 }).default('09:00'),
    rilDefaultExitTime: varchar('ril_default_exit_time', { length: 5 }).default('18:00'),
    rilLunchBreakMinutes: integer('ril_lunch_break_minutes').default(60),
    rilNoteOptions: jsonb('ril_note_options')
      .$type<StoredRilNoteOption[]>()
      .default(
        sql`'[{"value":"P","label":"Ferie"},{"value":"P2","label":"Permesso"},{"value":"M","label":"Malattia"},{"value":"F","label":"Festivita"}]'::jsonb`,
      ),
    rilTransferOptions: jsonb('ril_transfer_options')
      .$type<string[]>()
      .default(sql`'["In sede","Telelavoro"]'::jsonb`),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check('general_settings_id_check', sql`${table.id} = 1`),
    check(
      'general_settings_start_of_week_check',
      sql`${table.startOfWeek} IN ('Monday', 'Sunday')`,
    ),
    check(
      'general_settings_ai_provider_check',
      sql`${table.aiProvider} IN ('gemini', 'openrouter', 'anthropic', 'openai', 'ollama')`,
    ),
    check(
      'general_settings_ril_default_start_time_check',
      sql`${table.rilDefaultStartTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check(
      'general_settings_ril_default_exit_time_check',
      sql`${table.rilDefaultExitTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check(
      'general_settings_ril_lunch_break_minutes_check',
      sql`${table.rilLunchBreakMinutes} >= 0 AND ${table.rilLunchBreakMinutes} <= 240`,
    ),
    check(
      'general_settings_ril_note_options_array_check',
      sql`jsonb_typeof(${table.rilNoteOptions}) = 'array'`,
    ),
    check(
      'general_settings_ril_transfer_options_array_check',
      sql`jsonb_typeof(${table.rilTransferOptions}) = 'array'`,
    ),
    check(
      'general_settings_totp_enforced_role_ids_array_check',
      sql`jsonb_typeof(${table.totpEnforcedRoleIds}) = 'array'`,
    ),
    check(
      'general_settings_totp_exempt_role_ids_array_check',
      sql`jsonb_typeof(${table.totpExemptRoleIds}) = 'array'`,
    ),
    check(
      'general_settings_totp_exempt_user_ids_array_check',
      sql`jsonb_typeof(${table.totpExemptUserIds}) = 'array'`,
    ),
    check(
      'general_settings_session_idle_timeout_minutes_check',
      sql`${table.sessionIdleTimeoutMinutes} >= 5 AND ${table.sessionIdleTimeoutMinutes} <= 1440`,
    ),
  ],
);
