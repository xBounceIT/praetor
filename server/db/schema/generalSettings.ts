import { sql } from 'drizzle-orm';
import { boolean, integer, numeric, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

// Single-row config table: `id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1)` in schema.sql.
// CHECK constraints (id = 1, start_of_week IN ('Monday','Sunday'), ai_provider IN (...)) are
// not modeled here — same carve-out as `ldapConfig.ts` / `emailConfig.ts` / `settings.ts`
// ("Drizzle Kit's CHECK support is patchy"). Enforcement stays at the DB level.
//
// `daily_limit` is `numeric` — pg returns it as a string, the repo `parseFloat`s it in
// `mapRow`. Same pattern as `settings.dailyGoal` in settings.ts.
export const generalSettings = pgTable('general_settings', {
  id: integer('id').primaryKey().default(1),
  currency: varchar('currency', { length: 10 }).default('€'),
  dailyLimit: numeric('daily_limit', { precision: 4, scale: 2 }).default('8.00'),
  startOfWeek: varchar('start_of_week', { length: 10 }).default('Monday'),
  treatSaturdayAsHoliday: boolean('treat_saturday_as_holiday').default(true),
  enableAiReporting: boolean('enable_ai_reporting').default(false),
  geminiApiKey: varchar('gemini_api_key', { length: 255 }),
  aiProvider: varchar('ai_provider', { length: 20 }).default('gemini'),
  openrouterApiKey: varchar('openrouter_api_key', { length: 255 }),
  geminiModelId: varchar('gemini_model_id', { length: 255 }),
  openrouterModelId: varchar('openrouter_model_id', { length: 255 }),
  allowWeekendSelection: boolean('allow_weekend_selection').default(true),
  defaultLocation: varchar('default_location', { length: 20 }).default('remote'),
  updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`),
});
