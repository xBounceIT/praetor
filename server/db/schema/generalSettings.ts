import { sql } from 'drizzle-orm';
import { boolean, check, integer, numeric, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

// Single-row config table — `id` is pinned to 1 by both the column default and a CHECK.
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
    geminiApiKey: varchar('gemini_api_key', { length: 255 }),
    aiProvider: varchar('ai_provider', { length: 20 })
      .$type<'gemini' | 'openrouter'>()
      .default('gemini'),
    openrouterApiKey: varchar('openrouter_api_key', { length: 255 }),
    geminiModelId: varchar('gemini_model_id', { length: 255 }),
    openrouterModelId: varchar('openrouter_model_id', { length: 255 }),
    allowWeekendSelection: boolean('allow_weekend_selection').default(true),
    defaultLocation: varchar('default_location', { length: 20 }).default('remote'),
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
      sql`${table.aiProvider} IN ('gemini', 'openrouter')`,
    ),
  ],
);
